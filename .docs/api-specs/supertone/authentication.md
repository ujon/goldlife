> ## Documentation Index
> Fetch the complete documentation index at: https://docs.supertoneapi.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Authentication

> Issue an API key in the developer console and authenticate every Supertone API request with the `x-sup-api-key` header.

The Supertone API authenticates requests with an API key sent in a custom header. Keys are issued from the developer console and tied to your account.

## Issue a key

1. Sign in at [console.supertoneapi.com](https://console.supertoneapi.com).
2. Open **API Keys** and click **Create new key**.
3. Copy the key — it is only shown once. Store it as an environment variable, not in source.

```bash theme={"dark"}
export SUPERTONE_API_KEY="Kp9mZ3xQ7v..."
```

<Note>
  Each account can have up to **3 active API keys**. If a key is compromised, revoke it from the console and reissue.
</Note>

## Authenticate a request

Include the key in the `x-sup-api-key` request header on every call:

<Tabs>
  <Tab title="Python">
    The SDK reads the key from the constructor — wire it to your env var:

    ```python theme={"dark"}
    import os
    from supertone import Supertone

    client = Supertone(api_key=os.environ["SUPERTONE_API_KEY"])
    ```
  </Tab>

  <Tab title="TypeScript">
    ```typescript theme={"dark"}
    import { Supertone } from "@supertone/supertone";

    const client = new Supertone({ apiKey: process.env.SUPERTONE_API_KEY });
    ```
  </Tab>

  <Tab title="cURL">
    ```bash theme={"dark"}
    curl https://supertoneapi.com/v1/voices \
      -H "x-sup-api-key: $SUPERTONE_API_KEY"
    ```
  </Tab>
</Tabs>

## Authentication errors

| Status             | When it happens                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `401 Unauthorized` | The `x-sup-api-key` header is missing, malformed, or doesn't match an active key.                                                        |
| `403 Forbidden`    | The key is valid but doesn't have permission for the resource — for example, calling a cloned voice that belongs to a different account. |

See [Error handling](/en/docs/production/error-handling) for a full list and recommended responses.

## Security checklist

* **Never embed keys in client-side code.** Mobile apps, single-page apps, and browser extensions should call your own backend, which holds the key.
* **Use environment variables**, secrets managers, or a key-vault service. Don't commit keys to git or post them in logs.
* **Rotate** keys regularly and immediately if you suspect a leak — revoke from the console, reissue, and redeploy.
* **Scope by service.** If you operate multiple apps, issue separate keys so you can attribute usage and revoke individually.
