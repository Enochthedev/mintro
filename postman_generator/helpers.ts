// Shared types and helpers for Postman collection generation
export const PROJECT_URL = "https://kquthqdlixwoxzpyijcp.supabase.co";

export interface QueryParam {
    key: string;
    value: string;
    disabled?: boolean;
    description?: string;
}

export interface ResponseExample {
    name: string;
    status: number;
    body: any;
}

export function createRequest(
    name: string,
    method: string,
    endpoint: string,
    body: any = null,
    queryParams: QueryParam[] = [],
    exampleResponse: any = null,
    description: string = "",
    additionalResponses: ResponseExample[] = []
) {
    const request: any = {
        name,
        request: {
            method,
            header: [
                { key: "Authorization", value: "Bearer {{ACCESS_TOKEN}}" },
                { key: "Content-Type", value: "application/json" }
            ],
            url: {
                raw: `{{PROJECT_URL}}${endpoint}`,
                host: ["{{PROJECT_URL}}"],
                path: endpoint.split('/').filter((p: string) => p),
            },
            description
        }
    };

    if (queryParams && queryParams.length > 0) {
        request.request.url.query = queryParams.map((q: QueryParam) => ({
            key: q.key,
            value: q.value,
            disabled: q.disabled ?? false,
            description: q.description ?? ""
        }));
    }

    if (body !== null) {
        request.request.body = {
            mode: "raw",
            raw: JSON.stringify(body, null, 2),
            options: { raw: { language: "json" } }
        };
    }

    // Build responses array
    const responses = [];

    if (exampleResponse !== null) {
        responses.push({
            name: "Success Response",
            originalRequest: request.request,
            status: "OK",
            code: 200,
            header: [
                { key: "Content-Type", value: "application/json" }
            ],
            body: JSON.stringify(exampleResponse, null, 2)
        });
    }

    // Add additional response examples
    for (const resp of additionalResponses) {
        responses.push({
            name: resp.name,
            originalRequest: request.request,
            status: resp.status === 200 ? "OK" : resp.status === 400 ? "Bad Request" : resp.status === 404 ? "Not Found" : "Error",
            code: resp.status,
            header: [
                { key: "Content-Type", value: "application/json" }
            ],
            body: JSON.stringify(resp.body, null, 2)
        });
    }

    if (responses.length > 0) {
        request.response = responses;
    }

    return request;
}
