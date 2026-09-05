const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const port = Number(process.env.PORT || 8000);
const adminPassword = process.env.BLOG_ADMIN_PASSWORD;
const dataFile = path.join(__dirname, "data.json");
const sessions = new Map();

if (!adminPassword) {
    console.error("Set BLOG_ADMIN_PASSWORD before starting the server.");
    process.exit(1);
}

const initialData = {
    posts: [
        { id: "welcome", date: "2026-09-05", title: "hello from the homepage", body: "Welcome to my little corner of the internet. More posts soon!", image: "", pinned: true },
        { id: "online", date: "2026-08-30", title: "currently online", body: "Working on videos, playlists, and making this place feel like mine.", image: "", pinned: false }
    ],
    links: [
        { id: "youtube", label: "YouTube", url: "https://www.youtube.com/@0cean.mp44" }
    ],
    bookshelf: [
        { id: "book-1", type: "book", title: "currently reading", note: "books, games, albums, movies, etc" },
        { id: "media-1", type: "media", title: "music", note: "description." },
        { id: "game-1", type: "game", title: "favorite game", note: "Your top picks can live here." }
    ],
    music: { title: "my current soundtrack", url: "" },
    notes: []
};

function readData() {
    if (!fs.existsSync(dataFile)) {
        fs.writeFileSync(dataFile, JSON.stringify(initialData, null, 2));
    }
    return JSON.parse(fs.readFileSync(dataFile, "utf8"));
}

function writeData(data) {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

function cleanBody(body) {
    return String(body || "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/\s(on\w+|style|srcdoc)\s*=\s*(['"]).*?\2/gi, "")
        .replace(/javascript:/gi, "")
        .replace(/<(?!\/?(?:p|br|strong|b|em|i|u|s|strike|ul|ol|li|img)\b)[^>]*>/gi, "");
}

function send(response, status, body, headers = {}) {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
    response.end(JSON.stringify(body));
}

function isOwner(request) {
    const token = request.headers.cookie?.match(/owner=([^;]+)/)?.[1];
    return token && sessions.has(token);
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";
        request.on("data", (chunk) => {
            body += chunk;
            if (body.length > 4_000_000) request.destroy();
        });
        request.on("end", () => {
            try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
        });
        request.on("error", reject);
    });
}

function publicData() {
    const data = readData();
    const pinned = data.posts.find((post) => post.pinned);
    const rest = data.posts.filter((post) => post.id !== pinned?.id).sort((a, b) => b.date.localeCompare(a.date));
    return { posts: pinned ? [pinned, ...rest] : rest, links: data.links, bookshelf: data.bookshelf || [], music: data.music || { title: "", url: "" }, notes: data.notes || [] };
}

const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/posts" && request.method === "GET") return send(response, 200, publicData());
    if (url.pathname === "/api/site" && request.method === "GET") return send(response, 200, publicData());
    if (url.pathname === "/api/session" && request.method === "GET") return send(response, 200, { owner: Boolean(isOwner(request)) });

    if (url.pathname === "/api/notes" && request.method === "POST") {
        const body = await readBody(request);
        const text = String(body.text || "").trim().slice(0, 280);
        if (!text) return send(response, 400, { error: "A note cannot be empty." });
        const data = readData();
        const author = String(body.author || "anonymous").trim().slice(0, 40) || "anonymous";
        const note = { id: `note-${Date.now()}`, author, text, createdAt: new Date().toISOString() };
        data.notes = [note, ...(data.notes || [])].slice(0, 50);
        writeData(data);
        return send(response, 201, note);
    }

    if (url.pathname === "/api/login" && request.method === "POST") {
        const body = await readBody(request);
        if (body.password !== adminPassword) return send(response, 401, { error: "Incorrect password." });
        const token = crypto.randomBytes(32).toString("hex");
        sessions.set(token, true);
        return send(response, 200, { owner: true }, { "set-cookie": `owner=${token}; HttpOnly; SameSite=Strict; Path=/` });
    }

    if (url.pathname === "/api/logout" && request.method === "POST") {
        const token = request.headers.cookie?.match(/owner=([^;]+)/)?.[1];
        if (token) sessions.delete(token);
        return send(response, 200, { owner: false }, { "set-cookie": "owner=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
    }

    if (url.pathname.startsWith("/api/") && !isOwner(request)) return send(response, 401, { error: "Owner login required." });

    if (url.pathname === "/api/bookshelf" && request.method === "PUT") {
        const body = await readBody(request);
        const data = readData();
        data.bookshelf = Array.isArray(body.items) ? body.items.slice(0, 4).map((item, index) => ({ id: item.id || `shelf-${Date.now()}-${index}`, type: String(item.type || "media").slice(0, 20), title: String(item.title || "").trim().slice(0, 80), note: String(item.note || "").trim().slice(0, 280) })).filter((item) => item.title) : [];
        writeData(data);
        return send(response, 200, { bookshelf: data.bookshelf });
    }

    if (url.pathname === "/api/music" && request.method === "PUT") {
        const body = await readBody(request);
        const data = readData();
        const parsedUrl = String(body.url || "").trim();
        if (parsedUrl && !/^https?:\/\/(www\.)?(youtube\.com|youtu\.be|open\.spotify\.com)\//i.test(parsedUrl)) return send(response, 400, { error: "Use a YouTube or Spotify link." });
        data.music = { title: String(body.title || "my current soundtrack").trim().slice(0, 80), url: parsedUrl };
        writeData(data);
        return send(response, 200, { music: data.music });
    }

    const noteMatch = url.pathname.match(/^\/api\/notes\/([^/]+)$/);
    if (noteMatch && request.method === "DELETE") {
        const data = readData();
        data.notes = (data.notes || []).filter((note) => note.id !== noteMatch[1]);
        writeData(data);
        return send(response, 200, { deleted: true });
    }

    if (url.pathname === "/api/posts" && request.method === "POST") {
        const body = await readBody(request);
        if (!body.title || !body.date || !body.body) return send(response, 400, { error: "Title, date, and post text are required." });
        const data = readData();
        const post = { id: `post-${Date.now()}`, title: body.title, date: body.date, publishedAt: body.publishedAt || `${body.date}T12:00`, body: cleanBody(body.body), image: body.image || "", pinned: Boolean(body.pinned) };
        if (post.pinned) data.posts.forEach((item) => { item.pinned = false; });
        data.posts.unshift(post);
        writeData(data);
        return send(response, 201, post);
    }

    const postMatch = url.pathname.match(/^\/api\/posts\/([^/]+)$/);
    if (postMatch && request.method === "DELETE") {
        const data = readData();
        const remaining = data.posts.filter((item) => item.id !== postMatch[1]);
        if (remaining.length === data.posts.length) return send(response, 404, { error: "Post not found." });
        writeData({ ...data, posts: remaining });
        return send(response, 200, { deleted: true });
    }

    if (postMatch && request.method === "PUT") {
        const body = await readBody(request);
        const data = readData();
        const post = data.posts.find((item) => item.id === postMatch[1]);
        if (!post) return send(response, 404, { error: "Post not found." });
        Object.assign(post, { title: body.title, date: body.date, publishedAt: body.publishedAt || `${body.date}T12:00`, body: cleanBody(body.body), image: body.image || "", pinned: Boolean(body.pinned) });
        if (post.pinned) data.posts.forEach((item) => { if (item.id !== post.id) item.pinned = false; });
        writeData(data);
        return send(response, 200, post);
    }

    if (url.pathname === "/api/links" && request.method === "PUT") {
        const body = await readBody(request);
        const data = readData();
        data.links = Array.isArray(body.links) ? body.links.filter((link) => link.label && link.url).slice(0, 6) : [];
        writeData(data);
        return send(response, 200, { links: data.links });
    }

    if (request.method === "GET") {
        const filePath = url.pathname === "/" ? path.join(__dirname, "index.html") : path.join(__dirname, url.pathname);
        const contentType = url.pathname === "/favicon.svg" ? "image/svg+xml" : "text/html; charset=utf-8";
        if ([path.join(__dirname, "index.html"), path.join(__dirname, "favicon.svg")].includes(filePath) && fs.existsSync(filePath)) {
            response.writeHead(200, { "content-type": contentType });
            return response.end(fs.readFileSync(filePath));
        }
    }

    send(response, 404, { error: "Not found." });
});

server.listen(port, () => console.log(`Ocean blog running at http://localhost:${port}`));
