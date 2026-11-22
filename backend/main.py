"""Art feed API: FastAPI + SQLite. Images, comments with markers, graph edges, invite links.

Run:   uvicorn main:app --port 8080
Admin: python main.py admin-link   (prints a login link, e.g. if Google sign-in isn't set up)
"""
import hashlib, hmac, io, json, os, secrets, sqlite3, sys, time
from contextlib import closing
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image, ImageOps
from pydantic import BaseModel, Field

DB = os.getenv("DB_PATH", "art.db")
SECRET = os.getenv("SECRET") or secrets.token_hex(32)  # set it in production, or image links break on restart
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "").lower()
ADMIN_NAME = os.getenv("ADMIN_NAME", "artist")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
ORIGINS = os.getenv("ORIGINS", "http://localhost:5173").split(",")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173/")


def q(sql, args=(), one=False):
    with closing(sqlite3.connect(DB)) as c:
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys=ON")
        rows = [dict(r) for r in c.execute(sql, args).fetchall()]
        c.commit()
    return (rows[0] if rows else None) if one else rows


with closing(sqlite3.connect(DB)) as c:
    c.executescript("""
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, is_admin INT DEFAULT 0, created_at INT);
    CREATE TABLE IF NOT EXISTS tokens(hash TEXT PRIMARY KEY, user_id INT NOT NULL REFERENCES users ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS images(id INTEGER PRIMARY KEY, title TEXT, description TEXT, date TEXT,
        w INT, h INT, full BLOB, thumb BLOB, created_at INT);
    CREATE TABLE IF NOT EXISTS edges(parent INT REFERENCES images ON DELETE CASCADE,
        child INT REFERENCES images ON DELETE CASCADE, PRIMARY KEY(parent, child));
    CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY, image_id INT NOT NULL REFERENCES images ON DELETE CASCADE,
        user_id INT NOT NULL REFERENCES users ON DELETE CASCADE, body TEXT NOT NULL, shape TEXT, created_at INT);
    """)
    for col in ("x", "y"):  # graph position set by dragging; NULL = auto layout. ALTER so existing DBs get it too
        try: c.execute(f"ALTER TABLE images ADD COLUMN {col} REAL")
        except sqlite3.OperationalError: pass

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["*"], allow_headers=["*"])


# ---------- auth ----------
def sha(s): return hashlib.sha256(s.encode()).hexdigest()


def new_token(user_id):
    t = secrets.token_urlsafe(24)
    q("INSERT INTO tokens VALUES(?,?)", (sha(t), user_id))
    return t


def admin_id():
    u = q("SELECT id FROM users WHERE is_admin=1", one=True)
    return (u or q("INSERT INTO users(name,is_admin,created_at) VALUES(?,1,?) RETURNING id",
                   (ADMIN_NAME, int(time.time())), one=True))["id"]


def user(authorization: str = Header("")):
    u = q("SELECT users.* FROM tokens JOIN users ON users.id=user_id WHERE hash=?",
          (sha(authorization.removeprefix("Bearer ")),), one=True)
    if not u: raise HTTPException(401, "Invite only")
    return u


def admin(u=Depends(user)):
    if not u["is_admin"]: raise HTTPException(403, "Admin only")
    return u


class GoogleIn(BaseModel): credential: str


@app.post("/auth/google")
def google_login(b: GoogleIn):
    from google.auth.transport.requests import Request
    from google.oauth2 import id_token
    if not GOOGLE_CLIENT_ID or not ADMIN_EMAIL: raise HTTPException(400, "Google sign-in not configured")
    try: info = id_token.verify_oauth2_token(b.credential, Request(), GOOGLE_CLIENT_ID)
    except ValueError: raise HTTPException(401, "Invalid Google token")
    if not info.get("email_verified") or info.get("email", "").lower() != ADMIN_EMAIL:
        raise HTTPException(403, "This Google account isn't the admin")
    return {"token": new_token(admin_id())}


@app.get("/me")
def me(u=Depends(user)): return u


# ---------- friends (admin) ----------
class UserIn(BaseModel): name: str = Field(min_length=1, max_length=40)


@app.get("/users")
def users(_=Depends(admin)):
    return q("SELECT id,name,is_admin,(SELECT COUNT(*) FROM tokens WHERE user_id=users.id) links FROM users ORDER BY id")


@app.post("/users")
def add_user(b: UserIn, _=Depends(admin)):
    uid = q("INSERT INTO users(name,created_at) VALUES(?,?) RETURNING id", (b.name.strip(), int(time.time())), one=True)["id"]
    return {"id": uid, "token": new_token(uid)}


@app.post("/users/{uid}/link")
def relink(uid: int, _=Depends(admin)): return {"token": new_token(uid)}


@app.delete("/users/{uid}/link")
def revoke(uid: int, _=Depends(admin)):
    q("DELETE FROM tokens WHERE user_id=? AND user_id NOT IN (SELECT id FROM users WHERE is_admin=1)", (uid,))
    return {"ok": True}


# ---------- images ----------
def sign(iid, size, exp): return hmac.new(SECRET.encode(), f"{iid}:{size}:{exp}".encode(), "sha256").hexdigest()[:32]


def src(iid, size):  # signed link, so <img> tags work without auth headers; changes once a day for caching
    exp = (int(time.time()) // 86400 + 2) * 86400
    return f"/img/{iid}/{size}?exp={exp}&sig={sign(iid, size, exp)}"


@app.get("/img/{iid}/{size}")
def img(iid: int, size: str, exp: int, sig: str):
    if size not in ("full", "thumb") or exp < time.time() or not hmac.compare_digest(sig, sign(iid, size, exp)):
        raise HTTPException(403)
    row = q(f"SELECT {size} b FROM images WHERE id=?", (iid,), one=True)
    if not row: raise HTTPException(404)
    return Response(row["b"], media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


@app.get("/images")
def images(_=Depends(user)):
    rows = q("""SELECT id,title,description,date,w,h,x,y,
                (SELECT COUNT(*) FROM comments WHERE image_id=images.id) comments
                FROM images ORDER BY date DESC, id DESC""")
    edges = q("SELECT parent, child FROM edges")
    for r in rows:
        r.update(full=src(r["id"], "full"), thumb=src(r["id"], "thumb"),
                 parents=[e["parent"] for e in edges if e["child"] == r["id"]])
    return rows


def jpeg(im, size):
    im = im.copy()
    im.thumbnail((size, size))
    b = io.BytesIO()
    im.save(b, "JPEG", quality=85, optimize=True)  # re-encoding drops EXIF (incl. GPS location)
    return b.getvalue()


def set_parents(iid, parents):
    q("DELETE FROM edges WHERE child=?", (iid,))
    for p in parents:
        if p != iid: q("INSERT OR IGNORE INTO edges VALUES(?,?)", (p, iid))


@app.post("/images")
def upload(file: UploadFile = File(...), title: str = Form(""), description: str = Form(""),
           date: str = Form(""), parents: str = Form("[]"), _=Depends(admin)):
    try: im = ImageOps.exif_transpose(Image.open(file.file)).convert("RGB")  # fixes sideways phone photos
    except Exception: raise HTTPException(400, "Unsupported image")
    date = date or time.strftime("%Y-%m-%d")
    full = jpeg(im, 2560)
    w, h = Image.open(io.BytesIO(full)).size
    iid = q("""INSERT INTO images(title,description,date,w,h,full,thumb,created_at)
               VALUES(?,?,?,?,?,?,?,?) RETURNING id""",
            (title or date, description, date, w, h, full, jpeg(im, 480), int(time.time())), one=True)["id"]
    set_parents(iid, json.loads(parents))
    return {"id": iid}


class ImageEdit(BaseModel):
    title: str
    description: str = ""
    date: str
    parents: list[int] = []


@app.patch("/images/{iid}")
def edit(iid: int, b: ImageEdit, _=Depends(admin)):
    q("UPDATE images SET title=?,description=?,date=? WHERE id=?", (b.title or b.date, b.description, b.date, iid))
    set_parents(iid, b.parents)
    return {"id": iid}


@app.delete("/images/{iid}")
def delete_image(iid: int, _=Depends(admin)):
    q("DELETE FROM images WHERE id=?", (iid,))
    return {"ok": True}


class PosIn(BaseModel):
    x: float
    y: float


@app.put("/images/{iid}/pos")
def move(iid: int, b: PosIn, _=Depends(admin)):
    q("UPDATE images SET x=?,y=? WHERE id=?", (b.x, b.y, iid))
    return {"ok": True}


class EdgeIn(BaseModel):
    parent: int
    child: int


@app.post("/edges")
def add_edge(b: EdgeIn, _=Depends(admin)):
    if b.parent != b.child: q("INSERT OR IGNORE INTO edges VALUES(?,?)", (b.parent, b.child))
    return {"ok": True}


@app.delete("/edges/{parent}/{child}")
def del_edge(parent: int, child: int, _=Depends(admin)):
    q("DELETE FROM edges WHERE parent=? AND child=?", (parent, child))
    return {"ok": True}


# ---------- comments ----------
class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    shape: Optional[dict] = None  # {t: point|circle|rect|arrow|pen, x, y, x2, y2 | pts}; units: image width = 1


@app.get("/images/{iid}/comments")
def comments(iid: int, _=Depends(user)):
    rows = q("""SELECT c.id,c.user_id,u.name,u.is_admin,c.body,c.shape,c.created_at
                FROM comments c JOIN users u ON u.id=c.user_id WHERE image_id=? ORDER BY c.id""", (iid,))
    for r in rows: r["shape"] = r["shape"] and json.loads(r["shape"])
    return rows


@app.post("/images/{iid}/comments")
def add_comment(iid: int, b: CommentIn, u=Depends(user)):
    shape = b.shape and json.dumps(b.shape)
    if shape and len(shape) > 50_000: raise HTTPException(400, "Marker too large")
    return q("INSERT INTO comments(image_id,user_id,body,shape,created_at) VALUES(?,?,?,?,?) RETURNING id",
             (iid, u["id"], b.body.strip(), shape, int(time.time())), one=True)


@app.delete("/comments/{cid}")
def delete_comment(cid: int, u=Depends(user)):
    q("DELETE FROM comments WHERE id=? AND (user_id=? OR ?)", (cid, u["id"], u["is_admin"]))
    return {"ok": True}


if __name__ == "__main__" and sys.argv[1:] == ["admin-link"]:
    print(f"{FRONTEND_URL}#/invite/{new_token(admin_id())}")
