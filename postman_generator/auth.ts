// Authentication endpoints
import { createRequest } from "./helpers.ts";

export function getAuthenticationSection() {
    return {
        name: "🔐 Authentication",
        description: "Authentication endpoints using Supabase Auth. Get tokens to use with other API calls.",
        item: [
            {
                name: "Sign In with Password",
                request: {
                    method: "POST",
                    header: [
                        { key: "apikey", value: "{{ANON_KEY}}" },
                        { key: "Content-Type", value: "application/json" }
                    ],
                    url: {
                        raw: "{{PROJECT_URL}}/auth/v1/token?grant_type=password",
                        host: ["{{PROJECT_URL}}"],
                        path: ["auth", "v1", "token"],
                        query: [{ key: "grant_type", value: "password" }]
                    },
                    description: "Sign in with email and password. Returns access_token and refresh_token. Use the access_token in the Authorization header for subsequent API calls.",
                    body: {
                        mode: "raw",
                        raw: JSON.stringify({ email: "your-email@example.com", password: "your-password" }, null, 2),
                        options: { raw: { language: "json" } }
                    }
                },
                response: [
                    {
                        name: "Success Response",
                        originalRequest: {},
                        status: "OK",
                        code: 200,
                        header: [{ key: "Content-Type", value: "application/json" }],
                        body: JSON.stringify({
                            access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                            token_type: "bearer",
                            expires_in: 3600,
                            refresh_token: "refresh_token_here",
                            user: {
                                id: "user-uuid",
                                email: "your-email@example.com",
                                created_at: "2025-11-25T10:00:00Z",
                                role: "authenticated"
                            }
                        }, null, 2)
                    },
                    {
                        name: "Invalid Credentials",
                        originalRequest: {},
                        status: "Bad Request",
                        code: 400,
                        header: [{ key: "Content-Type", value: "application/json" }],
                        body: JSON.stringify({
                            error: "invalid_grant",
                            error_description: "Invalid login credentials"
                        }, null, 2)
                    }
                ]
            },
            {
                name: "Sign Up",
                request: {
                    method: "POST",
                    header: [
                        { key: "apikey", value: "{{ANON_KEY}}" },
                        { key: "Content-Type", value: "application/json" }
                    ],
                    url: {
                        raw: "{{PROJECT_URL}}/auth/v1/signup",
                        host: ["{{PROJECT_URL}}"],
                        path: ["auth", "v1", "signup"]
                    },
                    description: "Register a new user account. Email confirmation may be required depending on your Supabase settings.",
                    body: {
                        mode: "raw",
                        raw: JSON.stringify({ email: "new-user@example.com", password: "secure-password-123" }, null, 2),
                        options: { raw: { language: "json" } }
                    }
                },
                response: [
                    {
                        name: "Success Response",
                        originalRequest: {},
                        status: "OK",
                        code: 200,
                        header: [{ key: "Content-Type", value: "application/json" }],
                        body: JSON.stringify({
                            access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                            token_type: "bearer",
                            expires_in: 3600,
                            refresh_token: "refresh_token_here",
                            user: {
                                id: "new-user-uuid",
                                email: "new-user@example.com",
                                created_at: "2025-11-25T10:00:00Z"
                            }
                        }, null, 2)
                    },
                    {
                        name: "Email Already Registered",
                        originalRequest: {},
                        status: "Bad Request",
                        code: 400,
                        header: [{ key: "Content-Type", value: "application/json" }],
                        body: JSON.stringify({
                            error: "user_already_exists",
                            error_description: "A user with this email address has already been registered"
                        }, null, 2)
                    }
                ]
            },
            {
                name: "Refresh Token",
                request: {
                    method: "POST",
                    header: [
                        { key: "apikey", value: "{{ANON_KEY}}" },
                        { key: "Content-Type", value: "application/json" }
                    ],
                    url: {
                        raw: "{{PROJECT_URL}}/auth/v1/token?grant_type=refresh_token",
                        host: ["{{PROJECT_URL}}"],
                        path: ["auth", "v1", "token"],
                        query: [{ key: "grant_type", value: "refresh_token" }]
                    },
                    description: "Get a new access token using your refresh token. Use this when your access_token expires.",
                    body: {
                        mode: "raw",
                        raw: JSON.stringify({ refresh_token: "your-refresh-token-here" }, null, 2),
                        options: { raw: { language: "json" } }
                    }
                },
                response: [
                    {
                        name: "Success Response",
                        originalRequest: {},
                        status: "OK",
                        code: 200,
                        header: [{ key: "Content-Type", value: "application/json" }],
                        body: JSON.stringify({
                            access_token: "new-access-token...",
                            token_type: "bearer",
                            expires_in: 3600,
                            refresh_token: "new-refresh-token"
                        }, null, 2)
                    },
                    {
                        name: "Invalid Refresh Token",
                        originalRequest: {},
                        status: "Bad Request",
                        code: 400,
                        header: [{ key: "Content-Type", value: "application/json" }],
                        body: JSON.stringify({
                            error: "invalid_grant",
                            error_description: "Invalid Refresh Token"
                        }, null, 2)
                    }
                ]
            }
        ]
    };
}
