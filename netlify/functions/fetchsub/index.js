const { YoutubeTranscript } = require('youtube-transcript');
const https = require('https');

exports.handler = async function(event, context) {
    const videoUrl = event.queryStringParameters.url;
    const format = event.queryStringParameters.format;
    
    if (!videoUrl) {
        return { statusCode: 400, body: JSON.stringify({ error: 'URL fehlt' }) };
    }

    const videoID = extractVideoID(videoUrl);

    if (!videoID) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Ungültige YouTube-URL' }) };
    }

    try {
        const [rawTranscript, videoTitle] = await Promise.all([
            YoutubeTranscript.fetchTranscript(videoID),
            fetchVideoTitle(videoID)
        ]);
        
        if (!rawTranscript || rawTranscript.length === 0) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Keine Untertitel gefunden' }) };
        }

        const items = rawTranscript.map(item => ({
            start: item.offset / 1000,
            dur: (item.duration || 3000) / 1000,
            text: item.text
        }));

        const safeTitle = sanitizeFilename(videoTitle || videoID);

        if (format === 'json') {
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify({ videoId: videoID, title: safeTitle, items: items })
            };
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

        return {
            statusCode: 200,
            headers: {
                'Content-Type': `${mimeType}; charset=utf-8`,
                'Content-Disposition': `attachment; filename="${safeTitle}.${ext}"`
            },
            body: content
        };
    } catch (err) {
        return { statusCode: 404, body: JSON.stringify({ error: 'Keine Untertitel gefunden' }) };
    }
};

function fetchVideoTitle(videoID) {
    return new Promise((resolve) => {
        const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoID}&format=json`;
        https.get(url, (res) => {
            if (res.statusCode !== 200) return resolve(videoID);
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json.title || videoID);
                } catch (e) {
                    resolve(videoID);
                }
            });
        }).on('error', () => resolve(videoID));
    });
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