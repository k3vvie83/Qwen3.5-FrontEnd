#!/usr/bin/env node
/**
 * splitter.js — Split any file into N-MB parts and join them back.
 *
 * Usage:
 *   node splitter.js split <file>         [--size 10]
 *   node splitter.js join  <file.part000> [output]
 *
 * Examples:
 *   node splitter.js split qwen-chat-AMD64-v0.1.tar.gz
 *       → qwen-chat-AMD64-v0.1.tar.gz.part000
 *          qwen-chat-AMD64-v0.1.tar.gz.part001
 *          ...
 *
 *   node splitter.js split qwen-chat-AMD64-v0.1.tar.gz --size 25
 *       → splits into 25 MB parts instead
 *
 *   node splitter.js join qwen-chat-AMD64-v0.1.tar.gz.part000
 *       → qwen-chat-AMD64-v0.1.tar.gz   (auto-detect & merge all parts)
 *
 *   node splitter.js join qwen-chat-AMD64-v0.1.tar.gz.part000 restored.tar.gz
 *       → custom output name
 */

'use strict';

const fs   = require('fs');
const path = require('path');

/* ─── CLI parsing ───────────────────────────────────────────────────────────── */
const args = process.argv.slice(2);

function getFlag(flag, defaultVal) {
    const idx = args.indexOf(flag);
    if (idx === -1) return defaultVal;
    return args[idx + 1];
}

const mode      = args[0];
const inputFile = args[1];
const sizeMB    = parseFloat(getFlag('--size', 10));
const CHUNK_SIZE = Math.floor(sizeMB * 1024 * 1024);   // bytes

// For join, third positional arg is optional output (skip flags)
const extraArgs = args.slice(2).filter(a => !a.startsWith('--') && a !== String(sizeMB));
const outputArg = extraArgs[0] || null;

if (!mode || !inputFile || !['split', 'join'].includes(mode)) {
    console.error([
        '',
        '  Usage:',
        '    node splitter.js split <file>         [--size <MB>]',
        '    node splitter.js join  <file.part000> [output]',
        '',
        '  Examples:',
        '    node splitter.js split myfile.tar.gz',
        '    node splitter.js split myfile.tar.gz --size 25',
        '    node splitter.js join  myfile.tar.gz.part000',
        '    node splitter.js join  myfile.tar.gz.part000 restored.tar.gz',
        '',
    ].join('\n'));
    process.exit(1);
}

if (!fs.existsSync(inputFile)) {
    console.error(`\n  ✖  File not found: ${inputFile}\n`);
    process.exit(1);
}

/* ─── Helpers ───────────────────────────────────────────────────────────────── */
function fmtBytes(n) {
    if (n < 1024)       return `${n} B`;
    if (n < 1024 ** 2)  return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 ** 3)  return `${(n / 1024 ** 2).toFixed(2)} MB`;
    return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function partName(base, index) {
    return `${base}.part${String(index).padStart(3, '0')}`;
}

function progress(label, done, total) {
    const pct = total ? Math.min(100, Math.floor((done / total) * 100)) : 0;
    const bar = '█'.repeat(Math.floor(pct / 4)).padEnd(25, '░');
    process.stdout.write(`\r  ${label}  [${bar}] ${pct}%  ${fmtBytes(done)} / ${fmtBytes(total)}`);
}

/* ══════════════════════════════════════════════════════════════════════════════
   SPLIT
══════════════════════════════════════════════════════════════════════════════ */
async function split(inFile, chunkSize) {
    const totalSize  = fs.statSync(inFile).size;
    const totalParts = Math.ceil(totalSize / chunkSize);

    console.log(`\n  ▶  Splitting : ${inFile}`);
    console.log(`  ▶  File size : ${fmtBytes(totalSize)}`);
    console.log(`  ▶  Part size : ${fmtBytes(chunkSize)}`);
    console.log(`  ▶  Parts     : ${totalParts}\n`);

    const readStream = fs.createReadStream(inFile, { highWaterMark: 256 * 1024 });

    let partIndex    = 0;
    let partBytesWritten = 0;
    let totalWritten = 0;
    let writeStream  = null;
    const partFiles  = [];

    function openNextPart() {
        const pName = partName(inFile, partIndex);
        partFiles.push(pName);
        writeStream = fs.createWriteStream(pName);
        partBytesWritten = 0;
        partIndex++;
    }

    openNextPart();

    for await (const chunk of readStream) {
        let offset = 0;

        while (offset < chunk.length) {
            const remaining  = chunkSize - partBytesWritten;
            const slice      = chunk.slice(offset, offset + remaining);
            const canDrain   = writeStream.write(slice);

            partBytesWritten += slice.length;
            totalWritten     += slice.length;
            offset           += slice.length;

            if (!canDrain) {
                // Back-pressure: wait for drain before continuing
                await new Promise(r => writeStream.once('drain', r));
            }

            if (partBytesWritten >= chunkSize && totalWritten < totalSize) {
                // Close current part, open next
                await new Promise(r => writeStream.end(r));
                openNextPart();
            }
        }

        progress('Writing', totalWritten, totalSize);
    }

    // Close final part
    await new Promise(r => writeStream.end(r));
    progress('Writing', totalSize, totalSize);

    console.log('\n');
    partFiles.forEach((pf, i) => {
        const sz = fs.statSync(pf).size;
        console.log(`  ✔  Part ${String(i).padStart(3, '0')}  →  ${pf}  (${fmtBytes(sz)})`);
    });
    console.log(`\n  ✔  Split complete. ${totalParts} parts written.\n`);
}

/* ══════════════════════════════════════════════════════════════════════════════
   JOIN
══════════════════════════════════════════════════════════════════════════════ */
async function join(firstPart, outFile) {
    // Auto-detect all parts by scanning the directory for matching pattern
    const base    = firstPart.replace(/\.part\d+$/, '');
    const dir     = path.dirname(firstPart);
    const dirList = fs.readdirSync(dir || '.');

    const parts = dirList
        .filter(f => f.startsWith(path.basename(base) + '.part'))
        .map(f => path.join(dir || '.', f))
        .sort();   // lexicographic order works because of zero-padded index

    if (parts.length === 0) {
        console.error(`\n  ✖  No parts found matching: ${base}.part*\n`);
        process.exit(1);
    }

    const totalSize = parts.reduce((sum, p) => sum + fs.statSync(p).size, 0);

    // Default output: strip .partXXX suffix from base
    if (!outFile) outFile = base;

    console.log(`\n  ▶  Joining   : ${parts.length} parts  →  ${outFile}`);
    console.log(`  ▶  Total size: ${fmtBytes(totalSize)}\n`);

    parts.forEach((p, i) => {
        const sz = fs.statSync(p).size;
        console.log(`      Part ${String(i).padStart(3, '0')}  ←  ${p}  (${fmtBytes(sz)})`);
    });
    console.log('');

    const writeStream = fs.createWriteStream(outFile);
    let totalWritten  = 0;

    for (const partFile of parts) {
        const readStream = fs.createReadStream(partFile, { highWaterMark: 256 * 1024 });

        for await (const chunk of readStream) {
            const canDrain = writeStream.write(chunk);
            totalWritten  += chunk.length;
            if (!canDrain) {
                await new Promise(r => writeStream.once('drain', r));
            }
            progress('Reading', totalWritten, totalSize);
        }
    }

    await new Promise(r => writeStream.end(r));
    progress('Reading', totalSize, totalSize);

    const finalSize = fs.statSync(outFile).size;
    console.log(`\n\n  ✔  Done!  ${fmtBytes(finalSize)} written → ${outFile}`);

    // Integrity check: compare total expected vs written
    if (finalSize === totalSize) {
        console.log(`  ✔  Size check passed (${fmtBytes(finalSize)})\n`);
    } else {
        console.error(`  ✖  Size mismatch! Expected ${fmtBytes(totalSize)}, got ${fmtBytes(finalSize)}\n`);
        process.exit(1);
    }
}

/* ─── Route ─────────────────────────────────────────────────────────────────── */
if (mode === 'split') {
    split(inputFile, CHUNK_SIZE).catch(err => {
        console.error('\n  ✖  Error:', err.message);
        process.exit(1);
    });
} else {
    join(inputFile, outputArg).catch(err => {
        console.error('\n  ✖  Error:', err.message);
        process.exit(1);
    });
}
