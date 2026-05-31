> ## Documentation Index
> Fetch the complete documentation index at: https://docs.supertoneapi.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Search voices

> Filter the preset voice library by language, style, gender, age, use case, or model.

Returns preset voices matching the given filters. Multiple values per parameter are comma-separated and treated as OR conditions.

## Endpoint

```http theme={"dark"}
GET https://supertoneapi.com/v1/voices/search
```

## Query parameters

| Name              | Description                                      | Example                                        |
| ----------------- | ------------------------------------------------ | ---------------------------------------------- |
| `name`            | Voice name, partial match.                       | `Coco`                                         |
| `description`     | Description, partial match.                      | `kind and gentle`                              |
| `language`        | Language code, comma-separated.                  | `ko,en,ja`                                     |
| `gender`          | Voice gender, comma-separated.                   | `male,female`                                  |
| `age`             | Voice age group.                                 | `child`, `young-adult`, `middle-aged`, `elder` |
| `use_case`        | Primary use case.                                | `audiobook`, `narration`, `advertisement`      |
| `use_cases`       | Recommended use cases (OR).                      | `audiobook,narration`                          |
| `style`           | Emotional style. The first value is the default. | `neutral`, `happy`, `sad`, `angry`             |
| `model`           | Supported model.                                 | `sona_speech_1`                                |
| `page_size`       | Items per page. Default `20`, max `100`.         | `50`                                           |
| `next_page_token` | Token from a previous response.                  | `eyJpZCI6IjEyMzQ1In0=`                         |

<Note>
  `sort` is not supported. Results return in their natural order; sort client-side if needed.
</Note>

## Examples

**Filter by style and language:**

```http theme={"dark"}
GET /v1/voices/search?style=happy&language=ko,en
```

Returns voices that include `happy` in their style list and support either Korean or English.

**Paginate:**

```http theme={"dark"}
GET /v1/voices/search?page_size=50&next_page_token=eyJpZCI6IjEyMzQ1In0=
```

## Response

Returns `items` (array of voice objects) and `next_page_token` (string, optional). If no voices match, `items` is an empty array — the request still returns `200 OK`.

## Notes

* Comma-separated values are **OR**-ed: `language=ko,en&style=happy,sad` returns voices that support Korean OR English **and** have happy OR sad in their styles.
* Empty results are not an error — check `items.length` rather than relying on a 4xx response.
* For the full voice object shape (samples, supported models, etc.), see [Voices](/en/docs/core-concepts/voices#the-voice-object).

## See also

<CardGroup cols={2}>
  <Card title="Docs: Voices" icon="users" href="/en/docs/core-concepts/voices">
    Concept walkthrough with SDK code.
  </Card>

  <Card title="Voice search example" icon="lightbulb" href="/en/docs/examples/voice-search-and-preview">
    Build a searchable in-app voice picker.
  </Card>
</CardGroup>


## OpenAPI

````yaml /openapi.json GET /v1/voices/search
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
  /v1/voices/search:
    get:
      tags:
        - voices
      summary: Search voices.
      description: Search and filter voices based on various parameters.
      operationId: search_voices
      parameters:
        - name: page_size
          required: false
          in: query
          description: 'Number of items per page (default: 20, min: 10, max: 100)'
          schema:
            type: number
        - name: next_page_token
          required: false
          in: query
          description: Token for pagination (obtained from the previous page's response)
          schema:
            type: string
        - name: name
          required: false
          in: query
          description: Search across name. Space separated.
          schema:
            type: string
        - name: description
          required: false
          in: query
          description: Search across description. Space separated.
          schema:
            type: string
        - name: language
          required: false
          in: query
          description: Filter by language (comma-separated)
          schema:
            type: string
        - name: gender
          required: false
          in: query
          description: Filter by gender (comma-separated)
          schema:
            type: string
        - name: age
          required: false
          in: query
          description: Filter by age (comma-separated)
          schema:
            type: string
        - name: use_case
          required: false
          in: query
          description: Filter by use case (comma-separated)
          schema:
            type: string
        - name: use_cases
          required: false
          in: query
          description: Filter by use cases array (comma-separated for OR logic)
          schema:
            type: string
        - name: style
          required: false
          in: query
          description: >-
            Filter by style (comma-separated for OR, semicolon-separated for
            AND). Mixing comma and semicolon is invalid and will result in 400.
            Note: AND semantics apply across styles on a single character;
            cloned voices have a single style and will only match AND when
            exactly one style is requested and equals the cloned voice style.
          schema:
            type: string
        - name: model
          required: false
          in: query
          description: Filter by model (comma-separated)
          schema:
            type: string
      responses:
        '200':
          description: Paginated available voices response with next page token
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/GetAPICharacterListResponse'
        '400':
          description: >-
            Bad Request: Invalid style parameter (use either comma (OR) or
            semicolon (AND), not both)
        '401':
          description: 'Unauthorized: Invalid API key'
        '404':
          description: 'Not Found: No voices found'
        '500':
          description: 'Internal Server Error: Failed to get voices'
      security:
        - api-key: []
components:
  schemas:
    GetAPICharacterListResponse:
      type: object
      properties:
        items:
          description: List of character items
          type: array
          items:
            $ref: '#/components/schemas/GetAPICharacterResponseData'
        total:
          type: number
          description: >-
            Total number of available characters (might be approximate or
            removed in future)
          example: 150
        next_page_token:
          type: string
          description: >-
            Token for fetching the next page of results. Undefined if no more
            pages.
          example: some_opaque_token_string_representing_last_id
      required:
        - items
        - total
    GetAPICharacterResponseData:
      type: object
      properties:
        voice_id:
          type: string
          description: Unique identifier for the voice
          example: <voice-id>
        name:
          type: string
          description: Name of the voice
          example: Agatha
        description:
          type: string
          description: Description of the voice
          example: ''
          nullable: true
        age:
          type: string
          description: Age of the voice
          example: young-adult
        gender:
          type: string
          description: Gender of the voice
          example: female
        use_case:
          type: string
          description: Use case of the voice
          example: narration
        use_cases:
          description: Use cases of the voice (array)
          example:
            - narration
            - storytelling
          type: array
          items:
            type: string
        language:
          description: Languages supported by the voice
          example:
            - ar
            - bg
            - cs
            - da
            - de
            - el
            - en
            - es
            - et
            - fi
            - fr
            - hi
            - hu
            - id
            - it
            - ja
            - ko
            - nl
            - pl
            - pt
            - ro
            - ru
            - vi
          type: array
          items:
            type: string
        styles:
          description: Styles available for the voice
          example:
            - kind-default
            - normal
            - serene
          type: array
          items:
            type: string
        models:
          description: Models available for the voice
          example:
            - sona_speech_1
            - sona_speech_2
            - sona_speech_2_flash
            - supertonic_api_1
            - supertonic_api_3
          type: array
          items:
            type: string
        samples:
          description: URL to the sample audio file for the voice
          type: array
          items:
            $ref: '#/components/schemas/APISampleData'
        thumbnail_image_url:
          type: string
          description: URL to the thumbnail image for the voice
          example: https://example.com/thumbnails/voice-thumbnail.png
      required:
        - voice_id
        - name
        - age
        - gender
        - use_case
        - use_cases
        - language
        - styles
        - models
    APISampleData:
      type: object
      properties:
        language:
          type: string
          description: Language of the sample
          example: ko
        style:
          type: string
          description: Style of the sample
          example: kind-default
        model:
          type: string
          description: Model of the sample
          example: supertonic_api_3
        url:
          type: string
          description: URL to the sample audio file
          example: https://example.com/samples/sample-audio.wav
      required:
        - language
        - style
        - model
        - url
  securitySchemes:
    api-key:
      type: apiKey
      in: header
      name: x-sup-api-key

````