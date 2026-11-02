# Sharing the budget between two phones (one-time, ~10 minutes)

The app works on its own without any of this (data stays on that one phone). Do this once to make
you and your wife see the same budget live. It uses Firebase's free tier.

## 1. Create the Firebase project
1. Go to https://console.firebase.google.com and sign in with your Google account.
2. **Add project** → name it `simple-budget` → turn Google Analytics **off** → Create.

## 2. Turn on the three pieces
1. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable → Save.**
2. **Build → Firestore Database → Create database** → pick a nearby region → **Start in production mode**.
3. In Firestore, open the **Rules** tab, replace everything with the rules below, and **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /households/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## 3. Get the config
1. Project home → click the **`</>` (Web)** icon → nickname `simple-budget` → **Register app**.
2. Copy the block that looks like `const firebaseConfig = { apiKey: "...", authDomain: "...", ... }`.

## 4. Connect your phone
1. Open Simple Budget → **Settings → Share with your wife → Set up sync**.
2. Paste the config block, then enter a **household email and password** (any email; you'll both use
   the same one — it just has to be an address you can remember) → **Create household**.
3. If receipts are already on the phone it asks whether to upload them — say yes.

## 5. Connect your wife's phone
1. On your phone: **Settings → Copy setup code for the other phone**, and text it to her.
2. On her phone: open the app → **Settings → Set up sync** → paste the code, enter the **same**
   email and password → **Sign in**.

Your Claude API key is stored in the shared settings, so she doesn't need to enter it.
