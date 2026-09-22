// Minimal QR Code encoder → SVG. Byte mode only, versions 1–10 (auto), error
// correction level M, all 8 masks scored per ISO/IEC 18004 so the result is
// what any generator would emit. Written for this repo after the structure of
// Nayuki's qrcodegen (MIT); no dependency, no canvas, deterministic output.
//   qrSvg('https://sysaiq.com/p/ABCDEFGHJKMN', { size: 240, margin: 4 }) → '<svg …>'
//   encode(text) → { version, size, modules: Uint8Array(size*size) }  (1 = dark)
// Throws when the text does not fit version 10-M (≈ 213 bytes).

const EC_M_CODEWORDS_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const EC_M_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const MAX_VERSION = 10;

const sizeOf = ver => ver * 4 + 17;

// total codewords in a version (finders, timing, alignment and info bits removed)
function rawDataModules(ver) {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const a = Math.floor(ver / 7) + 2;
    n -= (25 * a - 10) * a - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}
const totalCodewords = ver => Math.floor(rawDataModules(ver) / 8);
const dataCodewords = ver => totalCodewords(ver) - EC_M_CODEWORDS_PER_BLOCK[ver] * EC_M_BLOCKS[ver];
const cciBits = ver => (ver >= 10 ? 16 : 8);   // byte-mode char count indicator
export const capacityBytes = ver => Math.floor((dataCodewords(ver) * 8 - 4 - cciBits(ver)) / 8);

// ---- GF(256) Reed–Solomon (poly 0x11D) --------------------------------------
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsGenerator(degree) {
  const g = new Array(degree).fill(0);
  g[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      g[j] = gfMul(g[j], root);
      if (j + 1 < degree) g[j] ^= g[j + 1];
    }
    root = gfMul(root, 2);
  }
  return g;
}
function rsRemainder(data, gen) {
  const r = new Array(gen.length).fill(0);
  for (const b of data) {
    const f = b ^ r.shift();
    r.push(0);
    for (let i = 0; i < gen.length; i++) r[i] ^= gfMul(gen[i], f);
  }
  return r;
}

// ---- bit stream → codewords ---------------------------------------------------
function chooseVersion(len) {
  for (let v = 1; v <= MAX_VERSION; v++) if (len <= capacityBytes(v)) return v;
  throw new Error(`qr: text too long (${len} bytes, max ${capacityBytes(MAX_VERSION)} for version ${MAX_VERSION}-M)`);
}

function makeCodewords(bytes, ver) {
  const bits = [];
  const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(4, 4);                       // byte mode
  push(bytes.length, cciBits(ver));
  for (const b of bytes) push(b, 8);
  const cap = dataCodewords(ver) * 8;
  push(0, Math.min(4, cap - bits.length));            // terminator
  while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));

  // split into blocks, append EC, interleave
  const nBlocks = EC_M_BLOCKS[ver];
  const ecLen = EC_M_CODEWORDS_PER_BLOCK[ver];
  const total = totalCodewords(ver);
  const shortLen = Math.floor(total / nBlocks) - ecLen;
  const nLong = total % nBlocks;
  const gen = rsGenerator(ecLen);
  const blocks = [];
  for (let i = 0, k = 0; i < nBlocks; i++) {
    const len = shortLen + (i < nBlocks - nLong ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    const ec = rsRemainder(dat, gen);
    if (i < nBlocks - nLong) dat.push(-1);            // placeholder keeps columns aligned
    blocks.push(dat.concat(ec));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) {
    for (const b of blocks) if (b[i] !== -1) out.push(b[i]);
  }
  return out;
}

// ---- matrix ----------------------------------------------------------------
function alignmentPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const pos = [6];
  for (let p = sizeOf(ver) - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
  return pos;
}

class Matrix {
  constructor(ver) {
    this.ver = ver;
    this.size = sizeOf(ver);
    this.m = new Uint8Array(this.size * this.size);      // 1 = dark
    this.fn = new Uint8Array(this.size * this.size);     // 1 = function module (never masked)
  }
  set(x, y, dark, fn = true) {
    const i = y * this.size + x;
    this.m[i] = dark ? 1 : 0;
    if (fn) this.fn[i] = 1;
  }
  get(x, y) { return this.m[y * this.size + x]; }

  drawFunctions() {
    const s = this.size;
    for (let i = 0; i < s; i++) { this.set(6, i, i % 2 === 0); this.set(i, 6, i % 2 === 0); }
    this.finder(3, 3); this.finder(s - 4, 3); this.finder(3, s - 4);
    const ap = alignmentPositions(this.ver);
    for (let i = 0; i < ap.length; i++) {
      for (let j = 0; j < ap.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) continue;
        this.alignment(ap[i], ap[j]);
      }
    }
    this.drawFormat(0);    // reserve the area; real bits come after masking
    this.drawVersion();
  }
  finder(cx, cy) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  alignment(cx, cy) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  drawFormat(mask) {
    const data = (0 << 3) | mask;          // EC level M = 00
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const b = i => (bits >>> i) & 1;
    for (let i = 0; i <= 5; i++) this.set(8, i, b(i));
    this.set(8, 7, b(6)); this.set(8, 8, b(7)); this.set(7, 8, b(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, b(i));
    const s = this.size;
    for (let i = 0; i < 8; i++) this.set(s - 1 - i, 8, b(i));
    for (let i = 8; i < 15; i++) this.set(8, s - 15 + i, b(i));
    this.set(8, s - 8, 1);                 // dark module
  }
  drawVersion() {
    if (this.ver < 7) return;
    let rem = this.ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.ver << 12) | rem;
    const s = this.size;
    for (let i = 0; i < 18; i++) {
      const bit = (bits >>> i) & 1;
      const a = s - 11 + (i % 3), b = Math.floor(i / 3);
      this.set(a, b, bit); this.set(b, a, bit);
    }
  }
  placeData(codewords) {
    const s = this.size;
    let i = 0;
    for (let right = s - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < s; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? s - 1 - vert : vert;
          const idx = y * s + x;
          if (!this.fn[idx] && i < codewords.length * 8) {
            this.m[idx] = (codewords[i >>> 3] >>> (7 - (i & 7))) & 1;
            i++;
          }
        }
      }
    }
  }
  applyMask(mask) {
    const s = this.size;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        let inv;
        switch (mask) {
          case 0: inv = (x + y) % 2 === 0; break;
          case 1: inv = y % 2 === 0; break;
          case 2: inv = x % 3 === 0; break;
          case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: inv = (x * y) % 2 + (x * y) % 3 === 0; break;
          case 6: inv = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
          default: inv = ((x + y) % 2 + (x * y) % 3) % 2 === 0;
        }
        const idx = y * s + x;
        if (!this.fn[idx] && inv) this.m[idx] ^= 1;
      }
    }
  }
  // ISO 18004 §7.8.3 scoring, as in qrcodegen: runs ≥ 5, 2×2 blocks,
  // finder-like 1:1:3:1:1 patterns (with light borders counted) and balance
  penalty() {
    const s = this.size, g = (x, y) => this.m[y * s + x];
    let p = 0;
    const countPatterns = h => {
      const n = h[1];
      const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
      return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
    };
    const addHistory = (h, len) => { if (h[0] === 0) len += s; h.pop(); h.unshift(len); };
    const line = get => {
      let total = 0;
      for (let a = 0; a < s; a++) {
        const h = [0, 0, 0, 0, 0, 0, 0];
        let color = 0, run = 0;
        for (let b = 0; b < s; b++) {
          const c = get(a, b);
          if (c === color) { run++; if (run === 5) total += 3; else if (run > 5) total++; }
          else {
            addHistory(h, run);
            if (color === 0) total += countPatterns(h) * 40;
            color = c; run = 1;
          }
        }
        if (color === 1) { addHistory(h, run); run = 0; }
        addHistory(h, run + s);
        total += countPatterns(h) * 40;
      }
      return total;
    };
    p += line((y, x) => g(x, y));   // rows
    p += line((x, y) => g(x, y));   // columns
    for (let y = 0; y < s - 1; y++) {
      for (let x = 0; x < s - 1; x++) {
        const c = g(x, y);
        if (c === g(x + 1, y) && c === g(x, y + 1) && c === g(x + 1, y + 1)) p += 3;
      }
    }
    let dark = 0;
    for (const v of this.m) dark += v;
    const k = Math.ceil(Math.abs(dark * 20 - s * s * 10) / (s * s)) - 1;
    p += k * 10;
    return p;
  }
}

export function encode(text) {
  const bytes = [...new TextEncoder().encode(String(text ?? ''))];
  const ver = chooseVersion(bytes.length);
  const cw = makeCodewords(bytes, ver);
  const mx = new Matrix(ver);
  mx.drawFunctions();
  mx.placeData(cw);
  let best = -1, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    mx.applyMask(mask);
    mx.drawFormat(mask);
    const score = mx.penalty();
    if (score < bestScore) { best = mask; bestScore = score; }
    mx.applyMask(mask);   // undo (XOR)
  }
  mx.applyMask(best);
  mx.drawFormat(best);
  return { version: ver, size: mx.size, mask: best, modules: mx.m };
}

// One <path> for all dark modules; crisp at any scale. `size` is the CSS
// pixel width; the viewBox works in modules so the SVG is tiny and
// deterministic for the same text.
export function qrSvg(text, { size = 240, margin = 4, dark = '#06101f', light = '#ffffff', title = '' } = {}) {
  const q = encode(text);
  const n = q.size + margin * 2;
  let d = '';
  for (let y = 0; y < q.size; y++) {
    for (let x = 0; x < q.size; x++) {
      if (q.modules[y * q.size + x]) d += `M${x + margin} ${y + margin}h1v1h-1z`;
    }
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${Number(size) || 240}" height="${Number(size) || 240}" shape-rendering="crispEdges" role="img"${title ? ` aria-label="${esc(title)}"` : ''}>` +
    (title ? `<title>${esc(title)}</title>` : '') +
    `<rect width="${n}" height="${n}" fill="${esc(light)}"/><path d="${d}" fill="${esc(dark)}"/></svg>`;
}
