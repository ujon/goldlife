> ## Documentation Index
> Fetch the complete documentation index at: https://docs.supertoneapi.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Create speech

> Convert text into a complete audio file using a voice of your choice.

Generates speech from text and returns the audio in the response body. For the conceptual walkthrough, SDK examples, and tips, see [Docs: Create speech](/en/docs/text-to-speech/create-speech).

## Endpoint

```http theme={"dark"}
POST https://supertoneapi.com/v1/text-to-speech/{voice_id}
```

## Path parameters

| Name       | Required | Description                 |
| ---------- | :------: | --------------------------- |
| `voice_id` |     ✅    | The ID of the target voice. |

## Request body

| Name               | Required | Description                                                                                                          |
| ------------------ | :------: | -------------------------------------------------------------------------------------------------------------------- |
| `text`             |     ✅    | The text to convert. **Max 300 characters.** Use an SDK or split client-side for longer input.                       |
| `language`         |     ✅    | Language code (e.g. `en`, `ko`, `ja`). Must be supported by the voice and the model.                                 |
| `style`            |     —    | Emotional style (e.g. `neutral`, `happy`). If omitted, the voice's default style is used.                            |
| `model`            |     —    | TTS model. Defaults to `sona_speech_1`.                                                                              |
| `output_format`    |     —    | `wav` (default) or `mp3`.                                                                                            |
| `voice_settings`   |     —    | Advanced voice parameters (see below).                                                                               |
| `include_phonemes` |     —    | If `true`, response switches to JSON with base64 audio plus phoneme timing data. Default: `false`.                   |
| `normalized_text`  |     —    | Pronunciation-normalized companion text (used by `sona_speech_2` and `sona_speech_2_flash`, primarily for Japanese). |

### Supported languages by model

| Model                                  | Languages                                                                                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sona_speech_2`, `sona_speech_2_flash` | `en`, `ko`, `ja`, `bg`, `cs`, `da`, `el`, `es`, `et`, `fi`, `hu`, `it`, `nl`, `pl`, `pt`, `ro`, `ar`, `de`, `fr`, `hi`, `id`, `ru`, `vi`                                                 |
| `supertonic_api_3`                     | `en`, `ko`, `ja`, `ar`, `bg`, `cs`, `da`, `de`, `el`, `es`, `et`, `fi`, `fr`, `hi`, `hr`, `hu`, `id`, `it`, `lt`, `lv`, `nl`, `pl`, `pt`, `ro`, `ru`, `sk`, `sl`, `sv`, `tr`, `uk`, `vi` |
| `supertonic_api_1`                     | `en`, `ko`, `ja`, `es`, `pt`                                                                                                                                                             |
| `sona_speech_1`                        | `en`, `ko`, `ja`                                                                                                                                                                         |

### Voice settings

Unsupported settings are silently ignored — they don't error.

| Name                            | Range    | Default | Description                                                      |
| ------------------------------- | -------- | ------- | ---------------------------------------------------------------- |
| `pitch_shift`                   | -24 → 24 | 0       | Pitch shift in semitones.                                        |
| `pitch_variance`                | 0 → 2    | 1       | Degree of pitch variation.                                       |
| `speed`                         | 0.5 → 2  | 1       | Playback rate multiplier. Applied after `duration`.              |
| `duration`                      | 0 → 60   | 0       | When non-zero, generates audio targeting this length in seconds. |
| `similarity`                    | 1 → 5    | 3       | How closely the output matches the original character voice.     |
| `text_guidance`                 | 0 → 4    | 1       | How sensitively delivery adapts to the text content.             |
| `subharmonic_amplitude_control` | 0 → 2    | 1       | Subharmonic amplitude in the generated speech.                   |

### Voice settings by model

| Setting                                     | `sona_speech_2` | `sona_speech_2_flash` | `supertonic_api_3` | `supertonic_api_1` | `sona_speech_1` |
| ------------------------------------------- | :-------------: | :-------------------: | :----------------: | :----------------: | :-------------: |
| `pitch_shift`, `pitch_variance`, `duration` |        ✅        |           ✅           |          —         |          —         |        ✅        |
| `speed`                                     |        ✅        |           ✅           |          ✅         |          ✅         |        ✅        |
| `similarity`, `text_guidance`               |        ✅        |           —           |          —         |          —         |        ✅        |
| `subharmonic_amplitude_control`             |        —        |           —           |          —         |          —         |        ✅        |

## Response

**Default (`include_phonemes=false`):** Binary audio in the body.

* `Content-Type: audio/wav` or `audio/mpeg` (matches `output_format`).
* `X-Audio-Length` header: duration of the generated audio in seconds.

**When `include_phonemes=true`:** JSON body with base64 audio plus phoneme arrays.

```json theme={"dark"}
{
  "audio_base64": "UklGRnoGAABXQVZF...",
  "phonemes": {
    "symbols": ["", "h", "ɐ", "ɡ", "ʌ", ""],
    "start_times_seconds": [0, 0.092, 0.197, 0.255, 0.29, 0.58],
    "durations_seconds": [0.092, 0.104, 0.058, 0.034, 0.29, 0.162]
  }
}
```

## Notes

* `text` over 300 characters returns `400`. Use the [Python](/en/docs/sdks/python) or [TypeScript](/en/docs/sdks/typescript) SDK for automatic chunking, or split manually — see [Long text](/en/docs/text-to-speech/long-text).
* `speed` applies after `duration`. Setting `duration=5` with `speed=2` produces \~10 seconds of audio.
* When `style` is omitted, the first value in the voice's `styles` array is used. Different voices can have different defaults — call [Get voice](/en/api-reference/endpoints/get-voice) to check.

## See also

<CardGroup cols={2}>
  <Card title="Docs: Create speech" icon="comment" href="/en/docs/text-to-speech/create-speech">
    Walkthrough with SDK examples.
  </Card>

  <Card title="Stream speech" icon="bolt" href="/en/api-reference/endpoints/stream-text-to-speech">
    Stream audio chunks instead of waiting for the full clip.
  </Card>
</CardGroup>


## OpenAPI

````yaml /openapi.json POST /v1/text-to-speech/{voice_id}
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
  /v1/text-to-speech/{voice_id}:
    post:
      tags:
        - text_to_speech
      summary: Convert text to speech
      description: Convert text to speech using the specified voice
      operationId: create_speech
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
            Returns either binary audio or JSON with phoneme data based on
            include_phonemes parameter
          content:
            audio/wav:
              schema:
                type: string
                format: binary
                description: Binary audio file (when include_phonemes=false or omitted)
            audio/mpeg:
              schema:
                type: string
                format: binary
                description: Binary audio file (when include_phonemes=false or omitted)
            application/json:
              schema:
                type: object
                description: >-
                  JSON response with base64 audio and phoneme data (when
                  include_phonemes=true)
                properties:
                  audio_base64:
                    type: string
                    description: Base64 encoded audio data
                    example: >-
                      UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhY...
                  phonemes:
                    type: object
                    description: Phoneme timing data with IPA symbols
                    properties:
                      symbols:
                        type: array
                        items:
                          type: string
                        description: List of IPA phonetic symbols
                        example:
                          - ''
                          - h
                          - ɐ
                          - ɡ
                          - ʌ
                          - ''
                      start_times_seconds:
                        type: array
                        items:
                          type: number
                        description: Start times for each phoneme in seconds
                        example:
                          - 0
                          - 0.092
                          - 0.197
                          - 0.255
                          - 0.29
                          - 0.58
                      durations_seconds:
                        type: array
                        items:
                          type: number
                        description: Duration for each phoneme in seconds
                        example:
                          - 0.092
                          - 0.104
                          - 0.058
                          - 0.034
                          - 0.29
                          - 0.162
                required:
                  - audio_base64
              examples:
                english-sample:
                  summary: English "Hello" with phoneme data
                  description: >-
                    Example response for English text "Hello" with phoneme
                    timing information
                  value:
                    audio_base64: >-
                      UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTuW1fzGfS8GI3fE8NyTQQoUXbPn7K5YFApCn+H0vWYhBTuY1vzCfiwGIXbC8d+WSAoTXLbm7K5ZEwpBnOL0vWQiBDyb1v3CfiwGIn+/8t+QSAkTW7Pp7K1XEglEM+DzvmclBTuY1fy/fysMJna/8t6WSAoSW7Lp7KlXEwhEM+H0vWQjBTub1vu/fyoLKHLA8t6UQAoOWbHo7K1ZEwpBnOL0vWMhBTyY1vy/fyoLJXfA8t+UQAoNWLPo7K1ZEwo/nOL0vWUiBDqY1vy/gCsNKHLA8t6SQgkOV7Hp7K1YEwhGm+L0vWYhBTue1vm/fyoLKHLA8t2UQgkPWLPo7KxbEgkAm+L0vWUIBD2b1fy7gCsNKHLA8tyXRAkSWbLm7K5cEglBm+DzvmUkBDya1vy+fyoLJ3fA8t2USgkMWLPo7KxbEgkAm+H0vWUIBD2b1fy8giwMJ3bB8tyXRAkSWbPm7K5bEgkBm+D0vWQkBDya1vy/fyoKKHfA8t2USgkOWLPo7KxZEgkCnODyvmUIBD2a1fy/gCsLJ3bA8t2WTAkNWLPo7KxZEggCnODyvmUJBT2a1vy/gCsKJ3bB8tyWTAkSWbPm7KxbEghCnODyvmQkBDya1v2/fyoLKHfA8t2USgkPWLPo7KtbEgkCnODyvmQkBDya1vy+fyoNKHfA8t2UTAkPWLPo7KtZEgkCnOH0vWQkBDua1vy/gCsLJ3fA8t2USwkPWLPo7KtZEgkCnOHzvWQkBDua1vy/gCsLJ3fA8t2USwkMWLPo7KtZEgkCnODyvmQkBDya1vy/gCsLJ3fA8t2UTAkMWLPo7KtZEgkCnODyvmQkBDya1vy+gCsLJ3fA8t2UTAkMWLPo7KtZEgkCnODyvmQkBDya1vy/gCsLJ3fA8t2UTAkLWLPo7KtZEgkCnOH0vWQkBDua1vy/gCsLJ3fA8t2UTAkLWLPo7KtZEgkCnOH0vWQkBDua1vy/gCsLJ3fA8t2UTAkLWLPo7KtZEgkCnOH0vWQkBDua
                    phonemes:
                      symbols:
                        - ''
                        - h
                        - ɐ
                        - ɡ
                        - ʌ
                        - ''
                      start_times_seconds:
                        - 0
                        - 0.0928798185941043
                        - 0.197369614512472
                        - 0.255419501133787
                        - 0.290249433106576
                        - 0.580498866213152
                      durations_seconds:
                        - 0.0928798185941043
                        - 0.104489795918367
                        - 0.0580498866213152
                        - 0.0348299319727891
                        - 0.290249433106576
                        - 0.162539682539683
                korean-sample:
                  summary: Korean "안녕하세요" with phoneme data
                  description: >-
                    Example response for Korean text "안녕하세요" with phoneme timing
                    information
                  value:
                    audio_base64: >-
                      UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhY...
                    phonemes:
                      symbols:
                        - ''
                        - ɐ
                        - nf
                        - 'n'
                        - iʌ
                        - ŋ
                        - ɐ
                        - s
                        - e
                        - io
                        - iʌ
                        - ''
                      start_times_seconds:
                        - 0
                        - 0.11609977324263
                        - 0.174149659863946
                        - 0.208979591836735
                        - 0.243809523809524
                        - 0.290249433106576
                        - 0.325079365079365
                        - 0.394739229024943
                        - 0.464399092970522
                        - 0.510839002267574
                        - 0.626938775510204
                        - 0.661768707482993
                      durations_seconds:
                        - 0.11609977324263
                        - 0.0580498866213152
                        - 0.0348299319727891
                        - 0.0348299319727891
                        - 0.0464399092970522
                        - 0.0348299319727891
                        - 0.0696598639455782
                        - 0.0696598639455782
                        - 0.0464399092970522
                        - 0.11609977324263
                        - 0.0348299319727891
                        - 0.0812698412698413
          headers:
            X-Audio-Length:
              description: Duration of the audio in seconds
              schema:
                type: number
        '400':
          description: >-
            Bad Request: Invalid request data for duration prediction or invalid
            request body/headers
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
          description: Not Enough Credits
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
          description: Rate Limit Exceeded
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/TooManyRequestsErrorResponse'
        '500':
          description: 'Internal Server Error: Failed to convert text to speech'
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