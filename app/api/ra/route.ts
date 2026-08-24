import { EdgeTTSClient } from "@/service/edge-tts-service/client"

const DEFAULT_FORMAT = "audio-24khz-48kbitrate-mono-mp3"

const FORMAT_CONTENT_TYPE = new Map<string, string>([
    ["raw-16khz-16bit-mono-pcm", "audio/basic"],
    ["raw-24khz-16bit-mono-pcm", "audio/basic"],
    ["raw-48khz-16bit-mono-pcm", "audio/basic"],
    ["webm-24khz-16bit-mono-opus", "audio/webm"],
    ["audio-24khz-48kbitrate-mono-mp3", "audio/mpeg"],
    ["audio-24khz-96kbitrate-mono-mp3", "audio/mpeg"],
])

function unauthorizedIfNeeded(request: Request) {
    const requiredToken = process.env.MS_RA_FORWARDER_TOKEN || process.env.TOKEN
    if (!requiredToken) {
        return null
    }

    const authorization = request.headers.get("authorization")
    if (authorization !== `Bearer ${requiredToken}`) {
        return new Response("Unauthorized", { status: 401 })
    }

    return null
}

function getFormat(request: Request) {
    const format = request.headers.get("format") || DEFAULT_FORMAT
    if (!FORMAT_CONTENT_TYPE.has(format)) {
        throw new Error(`Invalid audio format: ${format}`)
    }
    return format
}

async function convertSSML(ssml: string, format: string) {
    const result = await EdgeTTSClient.convert(ssml, {
        format,
        sentenceBoundaryEnabled: false,
        wordBoundaryEnabled: false,
    })

    return new Response(result.audio, {
        status: 200,
        headers: {
            "Content-Type": FORMAT_CONTENT_TYPE.get(format) || "audio/mpeg",
        },
    })
}

function escapeXml(text: string) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
}

function buildSSML(text: string, voiceName: string, speed: string) {
    return `<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xmlns:emo="http://www.w3.org/2009/10/emotionml" version="1.0" xml:lang="zh-CN"><voice name="${voiceName}"><prosody rate="${speed}%">${escapeXml(text)}</prosody></voice></speak>`
}

function buildSSMLFromParams(request: Request, text?: string) {
    const { searchParams } = new URL(request.url)
    const voiceName = searchParams.get("voiceName") || "zh-CN-XiaoxiaoNeural"
    const speed = searchParams.get("speed") || "0"
    return buildSSML(text || searchParams.get("text") || "你好", voiceName, speed)
}

function normalizeBodyToSSML(body: string, request: Request) {
    const content = body.trim()
    if (!content) {
        return buildSSMLFromParams(request)
    }

    if (content.startsWith("<")) {
        return body
    }

    try {
        const data = JSON.parse(content)
        if (typeof data?.text === "string") {
            return buildSSMLFromParams(request, data.text)
        }
    } catch {
        // Treat non-JSON request bodies as plain text for simple validation clients.
    }

    return buildSSMLFromParams(request, content)
}

export async function POST(request: Request) {
    try {
        const unauthorized = unauthorizedIfNeeded(request)
        if (unauthorized) {
            return unauthorized
        }

        const ssml = normalizeBodyToSSML(await request.text(), request)

        return await convertSSML(ssml, getFormat(request))
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error("ra post error", error)
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        })
    }
}

export async function GET(request: Request) {
    try {
        const unauthorized = unauthorizedIfNeeded(request)
        if (unauthorized) {
            return unauthorized
        }

        return await convertSSML(buildSSMLFromParams(request), getFormat(request))
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error("ra get error", error)
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        })
    }
}
