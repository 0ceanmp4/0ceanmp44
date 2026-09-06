# 0ceanmp44

## Run locally

This is a public-read, owner-write blog. Set an owner password before starting:

```sh
BLOG_ADMIN_PASSWORD="choose-a-long-password" npm start
```

Open `http://localhost:8000`. Visitors can read posts without logging in. The owner can use **owner login** to add or edit posts, attach images, pin one post, and edit profile links. Posts, links, and visitor notes are stored in `data.json` on the server, so they are shared by every visitor. Notes remain there indefinitely unless the owner deletes them.

For a public deployment, use a Node-compatible host with persistent disk storage and set `BLOG_ADMIN_PASSWORD` as a private environment variable. Do not commit the password. Persistent disk is required so notes and other content survive restarts and redeploys.
