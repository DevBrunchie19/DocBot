import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fuzzysort from 'fuzzysort';
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.static(path.join(__dirname, '../frontend')));

let sections = [];

/**
 * Extract text from PDF and split into page-level sections
 */
async function extractSectionsFromPDF(filePath, filename) {
    console.log(`📖 Extracting sections from PDF: ${filePath}`);
    const data = new Uint8Array(await fs.readFile(filePath));
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const pageSections = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const text = content.items.map(item => item.str).join(' ').trim();
        if (text) {
            pageSections.push({
                filename,
                page: i,
                content: text
            });
            console.log(`✅ Page ${i} extracted (${text.length} chars)`);
        }
    }

    return pageSections;
}

/**
 * Load all documents from data directory
 */
async function loadDocuments() {
    const dataDir = path.join(__dirname, 'data');
    try {
        const files = await fs.readdir(dataDir);
        const loadedSections = [];

        for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            const fullPath = path.join(dataDir, file);

            try {
                if (ext === '.pdf') {
                    const pdfSections = await extractSectionsFromPDF(fullPath, file);
                    loadedSections.push(...pdfSections);
                } else {
                    console.warn(`⚠️ Skipping unsupported file: ${file}`);
                }
            } catch (err) {
                console.error(`❌ Error processing ${file}:`, err.message);
            }
        }

        sections = loadedSections;
        console.log(`📄 Total sections loaded: ${sections.length}`);
    } catch (err) {
        console.error('❌ Failed to read data directory:', err.message);
    }
}

/**
 * Watch the data directory for changes
 */
function watchDataDirectory() {
    const dataDir = path.join(__dirname, 'data');
    console.log(`👀 Watching ${dataDir} for changes...`);

    fssync.watch(dataDir, async (eventType, filename) => {
        if (filename) {
            console.log(`🔄 Detected ${eventType} on ${filename}`);
            await loadDocuments();
        }
    });
}

/**
 * API endpoint for search
 */
app.get('/api/search', async (req, res) => {
    const query = req.query.q || '';
    if (!query) return res.json({ results: [] });

    if (sections.length === 0) {
        console.warn('⚠️ No sections loaded to search in');
        return res.json({ results: [] });
    }

    const results = fuzzysort.go(query, sections, {
        key: 'content',
        limit: 5,
        threshold: -1000
    });

    const getSnippet = (content, query, index) => {
        const safeIndex = index >= 0 ? index : content.toLowerCase().indexOf(query.toLowerCase());
        const start = Math.max(0, safeIndex);
        return content.substring(start, start + 300);
    };

    const formatted = results.map(r => ({
        snippet: getSnippet(r.obj.content, query, r.index),
        filename: r.obj.filename,
        page: r.obj.page
    }));

    console.log(`🔍 Search for "${query}" returned ${formatted.length} result(s)`);
    res.json({ results: formatted });
});

/**
 * Serve frontend
 */
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

/**
 * Start server
 */
app.listen(PORT, async () => {
    console.log(`[INFO] Server running on port ${PORT}`);
    await loadDocuments();
    watchDataDirectory();
});
