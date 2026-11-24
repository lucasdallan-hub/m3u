const size = 16;
const editionSuffix = /(?:\s+|\s*[|–-]\s*)(?:4k|8k|uhd|fhd|hd|sd|(?:480|720|1080|2160)p|dublado|legendado|dual[ -]?audio)\s*$|\s*[\[(](?:l|d|dub|leg|4k|8k|uhd|fhd|hd|sd|(?:480|720|1080|2160)p|dublado|legendado|dual[ -]?audio)[\])]\s*$/i;

function movieTitle(name) {
  let title = name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  while (editionSuffix.test(title)) title = title.replace(editionSuffix, "").trim();
  return title;
}

function coverUrl(cover) {
  if (/^https?:\/\//i.test(cover)) return cover;
  return cover.startsWith("//") ? `https:${cover}` : "";
}

async function readCover(url, context, signal) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.referrerPolicy = "no-referrer";
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
  let onAbort;
  try {
    await new Promise((resolve, reject) => {
      deadline.throwIfAborted();
      onAbort = () => reject(deadline.reason);
      deadline.addEventListener("abort", onAbort, { once: true });
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    context.clearRect(0, 0, size, size);
    context.drawImage(image, 0, 0, size, size);
    return context.getImageData(0, 0, size, size).data;
  } catch {
    signal.throwIfAborted();
    return null;
  } finally {
    if (onAbort) deadline.removeEventListener("abort", onAbort);
    image.removeAttribute("src");
  }
}

export function similarCovers(first, second) {
  if (!first || !second) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index++) {
    difference += Math.abs(first[index] - second[index]);
  }
  return difference <= first.length * 8;
}

export async function findRepeatedMovies(movies, signal, onProgress, loadCover) {
  const byTitle = new Map();
  for (const movie of movies) {
    const title = movieTitle(movie.name);
    if (!title) continue;
    if (!byTitle.has(title)) byTitle.set(title, []);
    byTitle.get(title).push(movie);
  }
  const candidates = [...byTitle.values()].filter(items => items.length > 1);
  const groupsByCandidate = [];
  let checked = 0;
  let unavailable = 0;
  let next = 0;
  onProgress(checked, candidates.length);

  if (!loadCover) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    loadCover = url => readCover(url, context, signal);
  }

  async function compareTitles() {
    while (next < candidates.length) {
      signal.throwIfAborted();
      const index = next++;
      const byCover = new Map();
      for (const movie of candidates[index]) {
        const url = coverUrl(movie.cover);
        if (!url) {
          unavailable++;
          continue;
        }
        if (!byCover.has(url)) byCover.set(url, []);
        byCover.get(url).push(movie);
      }

      const matches = [];
      for (const [url, versions] of byCover) {
        signal.throwIfAborted();
        const pixels = byCover.size > 1 ? await loadCover(url) : null;
        if (byCover.size > 1 && !pixels) unavailable += versions.length;
        const match = pixels && matches.find(group => similarCovers(group.pixels, pixels));
        if (match) {
          for (const version of versions) match.versions.push(version);
        }
        else matches.push({ pixels, versions });
      }
      groupsByCandidate[index] = matches.filter(group => group.versions.length > 1).map(group => group.versions);
      checked++;
      if (checked % 25 === 0 || checked === candidates.length) {
        onProgress(checked, candidates.length);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, compareTitles));
  return { groups: groupsByCandidate.flat(), unavailable };
}
