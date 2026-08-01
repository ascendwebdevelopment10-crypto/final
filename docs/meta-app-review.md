# Nitro Outreach — Meta App Review package

## Requested Instagram permissions

- `instagram_business_basic`: connect the customer-selected professional Instagram account and display its username/account connection inside Nitro.
- `instagram_business_content_publish`: publish a customer-approved image, carousel, or Reel from Content Studio to that same connected professional account.

Nitro never publishes automatically from the AI generator. The customer previews the content, edits or confirms the caption, then explicitly selects **Post to Instagram**.

## Reviewer test path

1. Open `https://nitrooutreach.com/login` and sign in with the reviewer account supplied in Meta App Review.
2. Open **Social Media** and select **Connect Instagram**.
3. Complete Instagram authorization and return to Nitro.
4. Open **Content Studio** and choose a saved image or Reel.
5. Select **Watch Reel** or inspect the image, confirm the caption, and select **Post to Instagram**.
6. Verify the success message and the published media on the connected test Instagram professional account.

## Screencast checklist

- Show the Nitro URL and signed-in workspace.
- Show the permission authorization screen without exposing passwords.
- Show the connected Instagram username inside Nitro.
- Show content preview and caption confirmation.
- Show the explicit publish click, success response, and resulting Instagram post.
- Keep the recording continuous and narrate why each permission is necessary.

## Reviewer notes

Nitro Outreach is a customer marketing workspace. Each customer connects only an Instagram professional account they control. Access tokens remain server-side. The integration uses the Instagram Login API and does not request access to unrelated accounts or publish without a direct customer action.
