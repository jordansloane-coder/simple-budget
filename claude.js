// Thin client for the Claude API, called straight from the browser with the household's own
// Anthropic API key (console.anthropic.com). Reads receipt photos and explains a month's spending.

const Claude = (() => {
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const MODEL = 'claude-sonnet-5-5';

  const GROUPS = [
    'Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery', 'Pantry', 'Frozen', 'Snacks & Sweets',
    'Drinks', 'Alcohol', 'Household', 'Health & Beauty', 'Baby & Pet', 'Prepared Food', 'Other',
  ];

  function receiptPrompt(catName, lineItems) {
    const items = lineItems
      ? `
Also extract every purchased line item as "items". For each item:
- "name": a short, human-readable product name. Expand receipt abbreviations (e.g. "ORG BNLS CHKN BRST" -> "Organic boneless chicken breast"). Keep brand/size only if it helps.
- "price": what was charged for that line (a number, after any discount printed on that line; no tax). If a quantity > 1 is charged, use the line total.
- "group": exactly one of ${GROUPS.map((g) => `"${g}"`).join(', ')}.
Skip subtotal/tax/total/payment lines. If a coupon or discount is a separate line, include it as an item with a negative price, group "Other". If the receipt is cut off or unreadable, include only the items you can actually read.`
      : '';
    const shape = lineItems
      ? '{"vendor": string|null, "total": number|null, "date": "YYYY-MM-DD"|null, "address": string|null, "items": [{"name": string, "price": number, "group": string}]}'
      : '{"vendor": string|null, "total": number|null, "date": "YYYY-MM-DD"|null, "address": string|null}';
    return `You read photos of paper or printed receipts for a couple tracking a monthly "${catName}" budget.
Extract the vendor/store name, the FINAL total actually charged (include tax and any tip; if a tip is handwritten or printed, include it), the date, and the street address/city printed on the receipt (only what is legible, never a guess).${items}
Respond with ONLY raw JSON, no markdown fences, no commentary, matching exactly this shape:
${shape}
If a field truly cannot be determined from the image, use null (or an empty list for items). Never fabricate a value.`;
  }

  function stripDataUrl(dataUrl) {
    const m = /^data:(image\/[a-zA-Z+]+);base64,(.*)$/.exec(dataUrl);
    if (!m) throw new Error('Unexpected image format.');
    return { mediaType: m[1], base64: m[2] };
  }

  function extractJson(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const raw = fenced ? fenced[1] : text;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('no json');
    return JSON.parse(raw.slice(start, end + 1));
  }

  async function call(apiKey, system, content, maxTokens) {
    if (!apiKey) throw new Error('NO_API_KEY');
    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }),
      });
    } catch (e) {
      throw new Error('Could not reach Claude — check your internet connection and try again.');
    }
    if (res.status === 401) throw new Error('That API key was rejected. Double-check it in Settings.');
    if (res.status === 429) throw new Error('Rate limited — wait a moment and try again.');
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Claude API error (${res.status}). ${body.slice(0, 140)}`);
    }
    const data = await res.json();
    const block = (data.content || []).find((b) => b.type === 'text');
    if (!block) throw new Error('Claude did not return readable text.');
    return { text: block.text, truncated: data.stop_reason === 'max_tokens' };
  }

  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && isFinite(parseFloat(v)) ? parseFloat(v) : null));

  return {
    GROUPS,

    // imageDataUrls: one data URL or an array. Several photos are treated as parts of ONE receipt.
    async parseReceipt(imageDataUrls, apiKey, category, todayIso) {
      const list = Array.isArray(imageDataUrls) ? imageDataUrls : [imageDataUrls];
      const blocks = list.map((u) => {
        const { mediaType, base64 } = stripDataUrl(u);
        return { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };
      });
      const many = list.length > 1
        ? ` There are ${list.length} photos, in order. They are different parts of the SAME single receipt (for example a long receipt photographed in sections); the photos may overlap, so do not count an item twice if it appears at the edge of two photos. Combine them into one result, and use the final total shown on the receipt.`
        : '';
      const { text, truncated } = await call(
        apiKey,
        receiptPrompt(category.name, !!category.lineItems),
        [
          ...blocks,
          { type: 'text', text: `Read this receipt and return the JSON described.${many} Today's date is ${todayIso}; use it to infer a missing year.` },
        ],
        category.lineItems ? 6000 : 600
      );
      let p;
      try { p = extractJson(text); } catch (e) {
        throw new Error(truncated ? 'That receipt is very long and got cut off — try scanning it in two halves, or enter it manually.' : 'Could not understand Claude\'s response — try again or enter it manually.');
      }
      const items = Array.isArray(p.items) ? p.items.map((it) => ({
        name: typeof it.name === 'string' ? it.name.trim() : '',
        price: num(it.price) ?? 0,
        group: GROUPS.includes(it.group) ? it.group : 'Other',
      })).filter((it) => it.name) : [];
      return {
        vendor: typeof p.vendor === 'string' ? p.vendor : null,
        total: num(p.total),
        date: typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : null,
        address: typeof p.address === 'string' ? p.address : null,
        items,
      };
    },

    async explain(summaryText, apiKey) {
      const { text } = await call(
        apiKey,
        'You help a couple understand where their money went. You are given a summary of one month of spending in one budget category (with the previous month for comparison). Write 3 to 5 short, plain sentences: what drove the total, what changed versus last month, and any specific notable items or stores worth a second look. Be concrete and friendly. No markdown, no bullet points, no preamble.',
        [{ type: 'text', text: summaryText }],
        600
      );
      return text.trim();
    },
  };
})();
