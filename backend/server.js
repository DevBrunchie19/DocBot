import express from 'express';
import fs from 'fs';
import path from 'path';
import { getDocument } from 'pdfjs-dist';
import mammoth from 'mammoth';
import Fuse from 'fuse.js';
import { fileURLToPath } from 'url';

// Fix __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

const dataDir = path.join(__dirname, 'data');
let documents = [];
let fuse = null;

async function extractPdfText(filePath) {
  const pdf = await getDocument(filePath).promise;
  let text = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }

  return text;
}

async function loadDocuments() {
  documents = []; // Reset documents

  if (!fs.existsSync(dataDir)) {
    console.log(`[INFO] Creating data folder at ${dataDir}`);
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const files = fs.readdirSync(dataDir).filter(file =>
    ['.pdf', '.docx', '.txt'].includes(path.extname(file).toLowerCase())
  );

  console.log(`[INFO] Found ${files.length} files in data folder`);

  for (const file of files) {
    const filePath = path.join(dataDir, file);
    try {
      let text = '';
      const ext = path.extname(file).toLowerCase();

      if (ext === '.pdf') {
        text = await extractPdfText(filePath);
      } else if (ext === '.docx') {
        const result = await mammoth.extractRawText({ path: filePath });
        text = result.value;
      } else if (ext === '.txt') {
        text = fs.readFileSync(filePath, 'utf8');
      }

      documents.push({ content: text });
      console.log(`[INFO] Loaded: ${file}`);
    } catch (err) {
      console.error(`[ERROR] Failed to load ${file}:`, err.message);
    }
  }

  fuse = new Fuse(documents, {
    includeScore: true,
    keys: ['content'],
    threshold: 0.4
  });
  console.log(`[INFO] Document index ready (${documents.length} documents)`);
}

// Serve frontend
const frontendDir = path.join(__dirname, '../frontend');
app.use(express.static(frontendDir));

// Search endpoint
app.get('/search', (req, res) => {
  if (!fuse) {
    return res.status(500).json({ error: 'Search index not ready' });
  }

  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'No query provided' });
  }

  const results = fuse.search(query).slice(0, 5).map(r => ({
    text: r.item.content.slice(0, 500) + (r.item.content.length > 500 ? '...' : '')
  }));

  res.json({ results });
});

// Fallback route
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`[INFO] Server running on port ${PORT}`);
  await loadDocuments();
});
