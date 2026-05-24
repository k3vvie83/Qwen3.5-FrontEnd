#!/usr/bin/env node
/**
 * b64convert.js — Encode any binary file to Base64 text, or decode it back.
 *
 * Usage:
 *   node b64convert.js encode <input.file>  [output.txt]
 *   node b64convert.js decode <input.txt>   [output.file]
 *
 * Examples:
 *   node b64convert.js encode qwen-chat-AMD64-v0.1.tar.gz
 *       → writes  qwen-chat-AMD64-v0.1.tar.gz.b64.txt
 *
 *   node b64convert.js decode qwen-chat-AMD64-v0.1.tar.gz.b64.txt
 *       → writes  qwen-chat-AMD64-v0.1.tar.gz.decoded
 *
 * Notes:
 *   - Streaming I/O — safe for large files (no full file loaded into RAM)
 *   - Base64 chunk size is always a multiple of 3 bytes to avoid padding issues
 *   - Shows live progress + final size report
 */

'use strict';

const fs   = require('fs');
const path = require('path');

/* ─── CLI args ─────────────────────────────────────────────────────────────── */
const [,, mode, inputFile, outputFile] = process.argv;

if (!mode || !inputFile || !['encode', 'decode'].includes(mode)) {
    console.error([
        '',
        '  Usage:',
        '    node b64convert.js encode <input.file>  [output.txt]',
        '    node b64convert.js decode <input.txt>   [output.file]',
        '',
    ].join('\n'));
    process.exit(1);
}

if (!fs.existsSync(inputFile)) {
    console.error(`✖  File not found: ${inputFile}`);
    process.exit(1);
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
function fmtBytes(n) {
    if (n < 1024)        return `${n} B`;
    if (n < 1024 ** 2)   return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 ** 3)   return `${(n / 1024 ** 2).toFixed(2)} MB`;
    return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function progress(done, total) {
    const pct  = total ? Math.floor((done / total) * 100) : '?';
    const bar  = total ? '█'.repeat(Math.floor(pct / 4)).padEnd(25, '░') : '░'.repeat(25);
    process.stdout.write(`\r  [${bar}] ${pct}%  ${fmtBytes(done)} / ${fmtBytes(total)}`);
}

/* ══════════════════════════════════════════════════════════════════════════════
   ENCODE  (binary → Base64 text)
══════════════════════════════════════════════════════════════════════════════ */
function encode(inFile, outFile) {
    const stat      = fs.statSync(inFile);
    const totalBytes = stat.size;

    console.log(`\n  ▶  Encoding: ${inFile}  (${fmtBytes(totalBytes)})`);
    console.log(`  ▶  Output : ${outFile}\n`);

    const readStream  = fs.createReadStream(inFile);
    const writeStream = fs.createWriteStream(outFile, { encoding: 'utf8' });

    // Base64 requires chunks to be multiples of 3 bytes to avoid mid-stream padding.
    // We accumulate a carry buffer of leftover bytes between chunks.
    const CHUNK = 3 * 1024;   // 3 KB — always a multiple of 3
    let carry    = Buffer.alloc(0);
    let written  = 0;

    readStream.on('readable', () => {
        let chunk;
        while (null !== (chunk = readStream.read(CHUNK))) {
            const buf = Buffer.concat([carry, chunk]);
            // Keep remainder so every encoded slice is padding-free
            const remainder = buf.length % 3;
            const encodable = buf.slice(0, buf.length - remainder);
            carry           = buf.slice(buf.length - remainder);

            if (encodable.length > 0) {
                writeStream.write(encodable.toString('base64'));
            }

            written += chunk.length;
            progress(written, totalBytes);
        }
    });

    readStream.on('end', () => {
        // Flush any remaining carry bytes (will include proper = padding)
        if (carry.length > 0) {
            writeStream.write(carry.toString('base64'));
        }
        writeStream.end();
    });

    writeStream.on('finish', () => {
        const outStat = fs.statSync(outFile);
        console.log(`\n\n  ✔  Done!  ${fmtBytes(outStat.size)} written → ${outFile}\n`);
    });

    readStream.on('error',  err => { console.error('\n✖  Read error:', err.message);  process.exit(1); });
    writeStream.on('error', err => { console.error('\n✖  Write error:', err.message); process.exit(1); });
}

/* ══════════════════════════════════════════════════════════════════════════════
   DECODE  (Base64 text → binary)
══════════════════════════════════════════════════════════════════════════════ */
function decode(inFile, outFile) {
    const stat       = fs.statSync(inFile);
    const totalBytes  = stat.size;

    console.log(`\n  ▶  Decoding: ${inFile}  (${fmtBytes(totalBytes)})`);
    console.log(`  ▶  Output : ${outFile}\n`);

    const readStream  = fs.createReadStream(inFile, { encoding: 'utf8' });
    const writeStream = fs.createWriteStream(outFile);

    // Base64 decode: accumulate text chunks, decode in multiples of 4 chars
    let carry  = '';
    let read   = 0;

    readStream.on('data', chunk => {
        // Strip whitespace (newlines, spaces) that editors might have inserted
        const text = (carry + chunk).replace(/\s/g, '');
        const remainder = text.length % 4;
        const decodable = text.slice(0, text.length - remainder);
        carry = text.slice(text.length - remainder);

        if (decodable.length > 0) {
            writeStream.write(Buffer.from(decodable, 'base64'));
        }

        read += chunk.length;
        progress(read, totalBytes);
    });

    readStream.on('end', () => {
        // Flush remaining carry (handles final padding)
        if (carry.length > 0) {
            writeStream.write(Buffer.from(carry, 'base64'));
        }
        writeStream.end();
    });

    writeStream.on('finish', () => {
        const outStat = fs.statSync(outFile);
        console.log(`\n\n  ✔  Done!  ${fmtBytes(outStat.size)} written → ${outFile}\n`);
    });

    readStream.on('error',  err => { console.error('\n✖  Read error:', err.message);  process.exit(1); });
    writeStream.on('error', err => { console.error('\n✖  Write error:', err.message); process.exit(1); });
}

/* ─── Route ────────────────────────────────────────────────────────────────── */
if (mode === 'encode') {
    const out = outputFile || inputFile + '.b64.txt';
    encode(inputFile, out);
} else {
    // Default decoded output: strip .b64.txt suffix, or append .decoded
    let out = outputFile;
    if (!out) {
        out = inputFile.endsWith('.b64.txt')
            ? inputFile.slice(0, -8)          // strip .b64.txt → original name
            : inputFile + '.decoded';
    }
    decode(inputFile, out);
}
