# Nitro multi-platform publishing setup

All providers use this callback URL:

`https://nitrooutreach.com/api/social-callback`

Secrets belong in Vercel Production environment variables, never in source control.

Each provider also has an explicit release gate. Leave it unset while the app is in development or review, then set it to `true` only after a real connect, renewal, publish, and disconnect test succeeds:

- `SOCIAL_FACEBOOK_ENABLED`
- `SOCIAL_TIKTOK_ENABLED`
- `SOCIAL_LINKEDIN_ENABLED`
- `SOCIAL_YOUTUBE_ENABLED`

## Facebook Pages

- Variables: `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` (the existing `META_APP_ID` and `META_APP_SECRET` are accepted as fallbacks).
- Products/permissions: Facebook Login for Business with `pages_show_list`, `pages_read_engagement`, and `pages_manage_posts`.
- Complete Meta App Review and Business Verification before offering the integration broadly.
- Every customer authorizes their own Facebook account; Nitro stores a Page token under that customer's record.

## TikTok

- Variables: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`.
- Optional: `TIKTOK_VERIFIED_MEDIA_HOSTS` is a comma-separated allowlist for verified photo-source domains. It defaults to `nitrooutreach.com,www.nitrooutreach.com`.
- Add Login Kit and the Content Posting API.
- Approve the `user.info.basic` and `video.publish` scopes.
- Register the callback URL and verify `https://nitrooutreach.com` for photo URL pulls.
- Complete TikTok's Direct Post audit. Before approval, TikTok restricts API-created posts to private visibility.

## LinkedIn

- Variables: `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`.
- Enable Sign In with LinkedIn using OpenID Connect and Share on LinkedIn.
- Approve `openid`, `profile`, and `w_member_social`.
- Register the callback URL exactly.

## YouTube

- Variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- Enable YouTube Data API v3 in the Google Cloud project.
- Add the callback URL to the OAuth web client.
- Configure the OAuth consent screen and request `youtube.upload`.
- Move the consent screen to Production and complete Google verification if required for external customers.

## Shared security

- Set `OAUTH_STATE_SECRET` to a long random production secret (Nitro can fall back to `CUSTOMER_AUTH_SECRET`, but a dedicated value is preferred).
- Optional: set `SOCIAL_REDIRECT_URI` if the production callback ever changes.
- Optional: set `FACEBOOK_GRAPH_VERSION` and `LINKEDIN_VERSION` to pin provider API versions.

## Release verification

For each provider, test with two separate Nitro customer accounts:

1. Connect and confirm the correct profile/Page/channel is displayed.
2. Schedule supported text, image, and video formats.
3. Confirm `scheduled → publishing → published` and the provider post ID.
4. Force an expired token and confirm automatic renewal or an honest reconnect state.
5. Disconnect and confirm the provider token is revoked where the provider supports revocation.
6. Confirm one customer can never read or publish through another customer's connection.
