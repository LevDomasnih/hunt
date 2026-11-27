# Security

Hunt touches private conversations and money, so a security problem matters more than a bug.

**Please do not open a public issue.** Use GitHub's private report instead: the *Security* tab of this repository → *Report a vulnerability*. Say what you found, how to see it, and what it lets someone do. We answer within a few days and tell you when it is fixed.

What we care about most:

- one person seeing another's project, contacts, messages or money (households must stay apart);
- a member seeing what only the owner may see (the budget cap never reaches the app; the said budget and the negotiation numbers are the owner's);
- the agent sending a message without the person's yes, or paying, signing, typing a password;
- tokens, sign-in links or session cookies that last longer or open more than they should;
- anything that leaks a login, a Telegram session or a browser profile from the agent's computer.

Out of scope: rate limits of the free Cloudflare tier, and bans of personal WhatsApp, Messenger or Instagram accounts (the README warns about them).
