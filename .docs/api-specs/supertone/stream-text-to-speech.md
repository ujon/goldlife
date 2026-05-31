> ## Documentation Index
> Fetch the complete documentation index at: https://docs.supertoneapi.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Stream speech

> Convert text to speech and return the output as a chunked audio stream.

Streams generated speech back chunk-by-chunk so you can start playback before the full clip is ready. For when to use streaming versus a fast non-streaming model, see [Docs: Stream speech](/en/docs/text-to-speech/stream-speech) and [Latency optimization](/en/docs/production/latency-optimization).

<Note>
  Streaming is currently supported on **`sona_speech_1`** only.
</Note>

## Endpoint

```http theme={"dark"}
POST https://supertoneapi.com/v1/text-to-speech/{voice_id}/stream
```

## Path parameters

| Name       | Required | Description                 |
| ---------- | :------: | --------------------------- |
| `voice_id` |     ✅    | The ID of the target voice. |

## Request body

`Content-Type: application/json`

| Name               | Required | Description                                                                                                        |
| ------------------ | :------: | ------------------------------------------------------------------------------------------------------------------ |
| `text`             |     ✅    | The text to convert. **Max 300 characters.**                                                                       |
| `language`         |     ✅    | Language code. Supported: `en`, `ko`, `ja`.                                                                        |
| `style`            |     —    | Emotional style (e.g. `neutral`, `happy`). If omitted, the voice's default style is used.                          |
| `model`            |     —    | Must be `sona_speech_1` (the only model that supports streaming).                                                  |
| `output_format`    |     —    | `wav` (default) or `mp3`.                                                                                          |
| `voice_settings`   |     —    | Advanced voice parameters — same fields and ranges as [Create speech](/en/api-reference/endpoints/text-to-speech). |
| `include_phonemes` |     —    | If `true`, response is NDJSON with phoneme data per chunk. Default: `false`.                                       |

## Response

**Default (`include_phonemes=false`):** Binary audio stream.

* `Content-Type: audio/wav` or `audio/mpeg` (matches `output_format`).
* The first chunk includes the audio file header; subsequent chunks are raw audio data.

**When `include_phonemes=true`:** Newline-delimited JSON (NDJSON), one object per chunk:

```jsonl theme={"dark"}
{"audio_base64":"...","phonemes":{"symbols":["","h"],"start_times_seconds":[0,0.05],"durations_seconds":[0.05,0.08]}}
{"audio_base64":"...","phonemes":{"symbols":["ɐ","ɡ"],"start_times_seconds":[0.13,0.19],"durations_seconds":[0.06,0.04]}}
```

## Notes

* Stream speech is currently in **beta** and supports only `sona_speech_1`.
* `text` over 300 characters returns `400`. SDKs auto-chunk longer input and forward chunks to your iterator.
* `speed` applies after `duration` (e.g. `duration=5` + `speed=2` ≈ 10 seconds).
* When `style` is omitted, the voice's default style is used. Use [Get voice](/en/api-reference/endpoints/get-voice) to inspect defaults.

## See also

<CardGroup cols={2}>
  <Card title="Docs: Stream speech" icon="bolt" href="/en/docs/text-to-speech/stream-speech">
    When to stream and how to consume chunks in each SDK.
  </Card>

  <Card title="LLM streaming TTS" icon="robot" href="/en/docs/examples/llm-streaming-tts">
    End-to-end recipes with OpenAI and Anthropic.
  </Card>
</CardGroup>


## OpenAPI

````yaml /openapi.json POST /v1/text-to-speech/{voice_id}/stream
openapi: 3.0.0
info:
  title: Supertone Public API
  description: >-
    Supertone API is a RESTful API for using our state-of-the-art AI voice
    models.
  version: 0.9.6
  contact: {}
servers:
  - url: https://supertoneapi.com
    description: Production
security: []
tags:
  - name: voices
    description: Voice Library API endpoints
  - name: custom_voices
    description: Custom Voice Management API endpoints
  - name: text_to_speech
    description: Text-to-Speech API endpoints
  - name: usage
    description: Usage Analytics API endpoints
paths:
  /v1/text-to-speech/{voice_id}/stream:
    post:
      tags:
        - text_to_speech
      summary: Convert text to speech with streaming response
      description: >-
        Convert text to speech using the specified voice with streaming
        response. Returns binary audio stream.
      operationId: stream_speech
      parameters:
        - name: voice_id
          required: true
          in: path
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/APIConvertTextToSpeechUsingCharacterRequest'
      responses:
        '200':
          description: >-
            Streaming audio data in binary format or NDJSON format with phoneme
            data based on includePhonemes parameter
          content:
            audio/wav:
              schema:
                type: string
                format: binary
                description: Binary audio stream (when includePhonemes=false or omitted)
            audio/mpeg:
              schema:
                type: string
                format: binary
                description: Binary audio stream (when includePhonemes=false or omitted)
            application/x-ndjson:
              schema:
                type: string
                description: >-
                  NDJSON stream with consistent format - each chunk contains
                  audio_base64 and phonemes fields (one null, one populated)
                example: >
                  {"audio_base64":"UklGRnoGAABXQVZF...","phonemes":null}

                  {"audio_base64":null,"phonemes":{"symbols":["","h","ɐ","l","oʊ"],"start_times_seconds":[0,0.1,0.2,0.3,0.4],"durations_seconds":[0.1,0.1,0.1,0.1,0.2]}}

                  {"audio_base64":"E4ATABFAD4AMQAp...","phonemes":null}

                  {"audio_base64":null,"phonemes":{"symbols":["w","ɝ","l","d"],"start_times_seconds":[0.5,0.6,0.7,0.8],"durations_seconds":[0.1,0.1,0.1,0.1]}}
          headers:
            Content-Type:
              description: >-
                Content type: audio/* for binary stream, application/x-ndjson
                for phoneme data
              schema:
                type: string
                enum:
                  - audio/wav
                  - audio/mpeg
                  - application/x-ndjson
                example: audio/mpeg
            Transfer-Encoding:
              description: Chunked transfer encoding
              schema:
                type: string
                example: chunked
            Cache-Control:
              description: No cache headers
              schema:
                type: string
                example: no-cache
            X-Content-Type-Options:
              description: Security header to prevent MIME sniffing
              schema:
                type: string
                example: nosniff
            Trailer:
              description: Announces that X-Audio-Length will be sent as a trailer header
              schema:
                type: string
                example: X-Audio-Length
            X-Audio-Length:
              description: >-
                Total duration of the audio in seconds (sent as trailer header
                after streaming completes)
              schema:
                type: number
        '400':
          description: 'Bad Request: Invalid request data or parameters'
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/BadRequestErrorResponse'
        '401':
          description: 'Unauthorized: Invalid API key'
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UnauthorizedErrorResponse'
        '402':
          description: 'Payment Required: Not enough credits'
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PaymentRequiredErrorResponse'
        '403':
          description: 'Forbidden: Permission denied'
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ForbiddenErrorResponse'
        '404':
          description: 'Not Found: Voice not found'
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/NotFoundErrorResponse'
        '408':
          description: Request Timeout
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RequestTimeoutErrorResponse'
        '429':
          description: 'Too Many Requests: Rate limit exceeded'
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TooManyRequestsErrorResponse'
        '500':
          description: 'Internal Server Error: Failed to process streaming TTS'
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/InternalServerErrorResponse'
      security:
        - api-key: []
components:
  schemas:
    APIConvertTextToSpeechUsingCharacterRequest:
      type: object
      properties:
        text:
          type: string
          description: The text to convert to speech
          maxLength: 300
        language:
          type: string
          description: The language code of the text
          enum:
            - en
            - ko
            - ja
            - bg
            - cs
            - da
            - el
            - es
            - et
            - fi
            - hu
            - it
            - nl
            - pl
            - pt
            - ro
            - ar
            - de
            - fr
            - hi
            - id
            - ru
            - vi
            - hr
            - lt
            - lv
            - sk
            - sl
            - sv
            - tr
            - uk
        style:
          type: string
          description: The style of character to use for the text-to-speech conversion
        model:
          type: string
          description: The model type to use for the text-to-speech conversion
          enum:
            - sona_speech_1
            - sona_speech_2
            - sona_speech_2_flash
            - supertonic_api_1
            - supertonic_api_3
          default: sona_speech_1
        output_format:
          type: string
          description: >-
            The desired output format of the audio file (wav, mp3). Default is
            wav.
          enum:
            - wav
            - mp3
          default: wav
        voice_settings:
          $ref: '#/components/schemas/ConvertTextToSpeechParameters'
        include_phonemes:
          type: boolean
          description: Return phoneme timing data with the audio
          default: false
        normalized_text:
          type: string
          description: >-
            Pre-normalized text for TTS. Only used with sona_speech_2 and
            sona_speech_2_flash models.
      required:
        - text
        - language
    BadRequestErrorResponse:
      type: object
      properties:
        status:
          type: string
          description: Response status
          example: error
        message:
          type: string
          description: Bad request error message
          example: Invalid request data
      required:
        - status
        - message
    UnauthorizedErrorResponse:
      type: object
      properties:
        status:
          type: string
          description: Response status
          example: error
        message:
          description: Unauthorized error details
          example:
            message: Invalid API Key
            error: Unauthorized
            statusCode: 401
          allOf:
            - $ref: '#/components/schemas/ErrorMessageData'
      required:
        - status
        - message
    PaymentRequiredErrorResponse:
      type: object
      properties:
        status:
          type: string
          description: Response status
          example: error
        message:
          description: Payment required error details
          example:
            message: Not enough credits
            error: Payment Required
            statusCode: 402
          allOf:
            - $ref: '#/components/schemas/ErrorMessageData'
      required:
        - status
        - message
    ForbiddenErrorResponse:
      type: object
      properties:
        status:
          type: string
          description: Response status
          example: error
        message:
          description: Forbidden error details
          example:
            message: Permission denied
            error: Forbidden
            statusCode: 403
          allOf:
            - $ref: '#/components/schemas/ErrorMessageData'
      required:
        - status
        - message
    NotFoundErrorResponse:
      type: object
      properties:
        status:
          type: string
          description: Response status
          example: error
        message:
          description: Not found error details
          example:
            message: Voice not found
            error: Not Found
            statusCode: 404
          allOf:
            - $ref: '#/components/schemas/ErrorMessageData'
      required:
        - status
        - message
    RequestTimeoutErrorResponse:
      type: object
      properties:
        status:
          type: string
          description: Response status
          example: error
        message:
          description: Request timeout error details
          example:
            message: Request timed out
            error: Request Timeout
            statusCode: 408
          allOf:
            - $ref: '#/components/schemas/ErrorMessageData'
      required:
        - status
        - message
    TooManyRequestsErrorResponse:
      type: object
      properties:
        status:
          type: string
          description: Response status
          example: error
        message:
          description: Too many requests error details
          example:
            message: rate limit exceeded
            error: Too Many Requests
            statusCode: 429
          allOf:
            - $ref: '#/components/schemas/ErrorMessageData'
      required:
        - status
        - message
    InternalServerErrorResponse:
      type: object
      properties:
        status:
          type: string
          description: Response status
          example: error
        message:
          description: Internal server error details
          example:
            message: Failed to convert text to speech
            error: Internal Server Error
            statusCode: 500
          allOf:
            - $ref: '#/components/schemas/ErrorMessageData'
      required:
        - status
        - message
    ConvertTextToSpeechParameters:
      type: object
      properties:
        pitch_shift:
          type: number
          default: 0
          minimum: -24
          maximum: 24
        pitch_variance:
          type: number
          default: 1
          minimum: 0
          maximum: 2
        speed:
          type: number
          default: 1
          minimum: 0.5
          maximum: 2
        duration:
          type: number
          description: Duration parameter for TTS generation
          default: 0
          minimum: 0
          maximum: 60
        similarity:
          type: number
          description: Similarity parameter for voice matching
          default: 3
          minimum: 1
          maximum: 5
        text_guidance:
          type: number
          description: Text guidance parameter for generation control
          default: 1
          minimum: 0
          maximum: 4
        subharmonic_amplitude_control:
          type: number
          description: Subharmonic amplitude control parameter
          default: 1
          minimum: 0
          maximum: 2
    ErrorMessageData:
      type: object
      properties:
        message:
          type: string
          description: Error message
          example: Invalid API Key
        error:
          type: string
          description: Error type
          example: Unauthorized
        status_code:
          type: number
          description: HTTP status code
          example: 401
      required:
        - message
        - error
        - status_code
  securitySchemes:
    api-key:
      type: apiKey
      in: header
      name: x-sup-api-key

````