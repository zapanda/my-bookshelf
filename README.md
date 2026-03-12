# myshelf 📚

A personal reading tracker — your Goodreads data, beautifully displayed.  
No backend, no login, no tracking. Just your books.

## Features

- 📖 Visual book grid with cover art (via Google Books)
- 🔍 Search & filter by title, author, shelf, year
- 📋 Want-to-read list
- 📊 Reading stats (books per year, top authors, rating distribution, pages read)
- ➕ Manually add books by searching
- 📁 Import your Goodreads CSV anytime to sync

---

## Setup (10 minutes)

### 1. Fork or clone this repo

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO
```

### 2. Add your Goodreads export

1. Go to Goodreads → **My Books** → **Import/Export** (bottom left sidebar)
2. Click **Export Library** — this downloads a `.csv` file
3. Rename it to `goodreads_library_export.csv`
4. Drop it into the root of this repo

### 3. Configure the CSV URL in index.html

Open `index.html` and find this line near the top of the `<script>` section:

```js
const GITHUB_CSV_URL = '';
```

Replace it with your raw GitHub file URL:

```js
const GITHUB_CSV_URL = 'https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/goodreads_library_export.csv';
```

### 4. Enable GitHub Pages

1. Push everything to GitHub
2. Go to your repo → **Settings** → **Pages**
3. Source: **Deploy from branch** → branch: `main` → folder: `/ (root)`
4. Click **Save**

Your app will be live at:  
`https://YOUR_USERNAME.github.io/YOUR_REPO/`

---

## Keeping your library up to date

Whenever you want to sync new books from Goodreads:

1. Export your library from Goodreads again
2. Replace `goodreads_library_export.csv` in the repo (drag & drop in the GitHub UI works great)
3. Commit — the app auto-reflects the changes

For day-to-day additions (especially want-to-read), use the **"+ Add Book"** button directly in the app — it searches Google Books and saves to your browser.

---

## Data & Privacy

- All your book data is stored in **your browser's localStorage**
- The CSV is read from your **own GitHub repo** — nothing is sent to any third-party server
- Cover art is fetched from the **Google Books API** (no API key required for personal use)

---

## File structure

```
your-repo/
├── index.html                    ← The entire app (single file)
├── goodreads_library_export.csv  ← Your Goodreads export
└── README.md
```
