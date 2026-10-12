const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const Parser = require('rss-parser');
const path = require('path');

const PORT = process.env.PORT || 3000;
const REFRESH_MINUTES = 30; // كل كام دقيقة السيرفر يسحب أخبار جديدة

// مصادر الأخبار (RSS). تقدر تضيف أو تشيل أي مصدر من هنا.
const FEEDS = [
  { name: 'IGN', url: 'https://feeds.feedburner.com/ign/all' },
  { name: 'PC Gamer', url: 'https://www.pcgamer.com/rss/' },
  { name: 'GameSpot', url: 'https://www.gamespot.com/feeds/news/' },
  { name: 'Eurogamer', url: 'https://www.eurogamer.net/feed' }
];

const db = new DatabaseSync(path.join(__dirname, 'news.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY,
    link TEXT UNIQUE,
    title TEXT,
    summary TEXT,
    image TEXT,
    source TEXT,
    published INTEGER
  );
  CREATE TABLE IF NOT EXISTS stats (key TEXT PRIMARY KEY, value INTEGER);
  INSERT OR IGNORE INTO stats VALUES ('visits', 0);
`);

const parser = new Parser({
  timeout: 15000,
  customFields: {
    item: [['media:content', 'media'], ['media:thumbnail', 'thumb']]
  }
});

const insert = db.prepare(
  `INSERT OR IGNORE INTO articles (link, title, summary, image, source, published)
   VALUES (@link, @title, @summary, @image, @source, @published)`
);

function pickImage(item) {
  return (
    (item.enclosure && item.enclosure.url) ||
    (item.media && item.media.$ && item.media.$.url) ||
    (item.thumb && item.thumb.$ && item.thumb.$.url) ||
    ((item.content || '').match(/<img[^>]+src=["']([^"']+)/i) || [])[1] ||
    null
  );
}

async function fetchAll() {
  for (const feed of FEEDS) {
    try {
      const data = await parser.parseURL(feed.url);
      for (const item of data.items.slice(0, 30)) {
        if (!item.link || !item.title) continue;
        insert.run({
          link: item.link,
          title: item.title.trim(),
          summary: (item.contentSnippet || '').replace(/\s+/g, ' ').slice(0, 200),
          image: pickImage(item),
          source: feed.name,
          published: Date.parse(item.isoDate || item.pubDate || '') || Date.now()
        });
      }
      console.log(`✓ ${feed.name}`);
    } catch (err) {
      console.log(`✗ ${feed.name}: ${err.message}`);
    }
  }
}

fetchAll();
setInterval(fetchAll, REFRESH_MINUTES * 60 * 1000);

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// عداد الزوار
app.post('/api/visit', (req, res) => {
  db.prepare("UPDATE stats SET value = value + 1 WHERE key = 'visits'").run();
  res.json(db.prepare("SELECT value AS visits FROM stats WHERE key = 'visits'").get());
});

app.get('/api/visits', (req, res) => {
  res.json(db.prepare("SELECT value AS visits FROM stats WHERE key = 'visits'").get());
});

// كل مرة بترجع تشكيلة مختلفة من آخر الأخبار، زي أعداد المجلة
app.get('/api/news', (req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM (SELECT * FROM articles ORDER BY published DESC LIMIT 150)
       ORDER BY RANDOM() LIMIT 13`
    )
    .all();
  const withImage = rows.findIndex(r => r.image);
  if (withImage > 0) rows.unshift(rows.splice(withImage, 1)[0]); // الخبر الرئيسي لازم يكون له صورة
  res.json(rows);
});

app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
