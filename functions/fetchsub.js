import { YoutubeTranscript } from 'youtube-transcript';

export async function onRequest(context) {
    const { request } = context;
    const urlObj = new URL(request.url);
    const videoUrl = urlObj.searchParams.get('url');
    const format = urlObj.searchParams.get('format') || 'json';
    
    if (!videoUrl) {
        return new Response(JSON.stringify({ error: 'URL fehlt' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    }

    const videoID = extractVideoID(videoUrl);

    if (!videoID) {
        return new Response(JSON.stringify({ error: 'Ungültige YouTube-URL' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    }

    try {
        const [rawTranscript, videoTitle] = await Promise.all([
            YoutubeTranscript.fetchTranscript(videoID),
            fetchVideoTitle(videoID)
        ]);
        
        if (!rawTranscript || rawTranscript.length === 0) {
            return new Response(JSON.stringify({ error: 'Keine Untertitel gefunden' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json; charset=utf-8' }
            });
        }

        const items = rawTranscript.map(item => ({
            start: item.offset / 1000,
            dur: (item.duration || 3000) / 1000,
            text: item.text
        }));

        const safeTitle = sanitizeFilename(videoTitle || videoID);

        if (format === 'json') {
            return new Response(JSON.stringify({ videoId: videoID, title: safeTitle, items: items }), {
                status: 200,
                headers: { 'Content-Type': 'application/json; charset=utf-8' }
            });
        }

        let content = '';
        let mimeType = 'text/plain';
        let ext = format;

        if (format === 'txt') {
            content = items.map(i => i.text).join(' ');
        } else if (format === 'md') {
            content = items.map(i => `**(${formatShortTime(i.start)})** ${i.text}`).join('\n\n');
        } else if (format === 'srt') {
            content = items.map((i, idx) => {
                return `${idx + 1}\n${formatSrtTime(i.start)} --> ${formatSrtTime(i.start + (i.dur || 3))}\n${i.text}\n`;
            }).join('\n');
        } else if (format === 'vtt') {
            content = 'WEBVTT\n\n' + items.map(i => {
                return `${formatVttTime(i.start)} --> ${formatVttTime(i.start + (i.dur || 3))}\n${i.text}\n`;
            }).join('\n');
        }

        return new Response(content, {
            status: 200,
            headers: {
                'Content-Type': `${mimeType}; charset=utf-8`,
                'Content-Disposition': `attachment; filename="${safeTitle}.${ext}"`
            }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: 'Keine Untertitel gefunden' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    }
}

async function fetchVideoTitle(videoID) {
    try {
        const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoID}&format=json`);
        if (!res.ok) return videoID;
        const json = await res.json();
        return json.title || videoID;
    } catch (e) {
        return videoID;
    }
}

function sanitizeFilename(name) {
    return name.replace(/[\/\\?%*:|"<>]/g, '').trim().replace(/\s+/g, '_');
}

function extractVideoID(url) {
    try {
        const parsed = new URL(url);
        if (parsed.hostname === 'youtu.be') {
            return parsed.pathname.slice(1);
        }
        if (parsed.hostname.includes('youtube.com')) {
            if (parsed.pathname.startsWith('/embed/') || parsed.pathname.startsWith('/v/')) {
                return parsed.pathname.split('/')[2];
            }
            return parsed.searchParams.get('v');
        }
    } catch (e) {
        const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
        return match ? match[1] : null;
    }
    return null;
}

function formatShortTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function formatSrtTime(sec) {
    const h = Math.floor(sec / 3600).toString().padStart(2, '0');
    const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    const ms = Math.floor((sec % 1) * 1000).toString().padStart(3, '0');
    return `${h}:${m}:${s},${ms}`;
}

function formatVttTime(sec) {
    return formatSrtTime(sec).replace(',', '.');
}
