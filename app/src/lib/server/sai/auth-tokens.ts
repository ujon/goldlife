import { env } from '$env/dynamic/private';
import type { Cookies } from '@sveltejs/kit';
import type { AuthResult } from './repository';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const JWT_ISSUER = 'sai';

type TokenKind = 'access' | 'refresh';

type JwtPayload = {
	sub: string;
	email: string;
	type: TokenKind;
	iss: string;
	iat: number;
	exp: number;
	jti?: string;
};

export async function issueAuthTokens(user: AuthResult['user']) {
	const now = Math.floor(Date.now() / 1000);
	return {
		accessToken: await signJwt({
			sub: user.id,
			email: user.email,
			type: 'access',
			iss: JWT_ISSUER,
			iat: now,
			exp: now + ACCESS_TOKEN_TTL_SECONDS
		}),
		refreshToken: await signJwt({
			sub: user.id,
			email: user.email,
			type: 'refresh',
			iss: JWT_ISSUER,
			iat: now,
			exp: now + REFRESH_TOKEN_TTL_SECONDS,
			jti: await randomId()
		})
	};
}

export async function setAuthCookies(
	cookies: Cookies,
	user: AuthResult['user'],
	options: { secure: boolean }
) {
	const tokens = await issueAuthTokens(user);
	cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
		httpOnly: true,
		sameSite: 'lax',
		secure: options.secure,
		path: '/',
		maxAge: ACCESS_TOKEN_TTL_SECONDS
	});
	cookies.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
		httpOnly: true,
		sameSite: 'lax',
		secure: options.secure,
		path: '/',
		maxAge: REFRESH_TOKEN_TTL_SECONDS
	});
}

export function clearAuthCookies(cookies: Cookies, options: { secure: boolean }) {
	const cookieOptions = {
		httpOnly: true,
		sameSite: 'lax' as const,
		secure: options.secure,
		path: '/'
	};
	cookies.delete(ACCESS_TOKEN_COOKIE, cookieOptions);
	cookies.delete(REFRESH_TOKEN_COOKIE, cookieOptions);
}

async function signJwt(payload: JwtPayload) {
	const header = { alg: 'HS256', typ: 'JWT' };
	const encodedHeader = base64urlEncode(JSON.stringify(header));
	const encodedPayload = base64urlEncode(JSON.stringify(payload));
	const signature = await hmacSha256(`${encodedHeader}.${encodedPayload}`, jwtSecret());
	return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function jwtSecret() {
	return (
		env.JWT_SECRET || env.AUTH_SECRET || env.SESSION_SECRET || 'sai-local-dev-secret-change-me'
	);
}

async function hmacSha256(value: string, secret: string) {
	const cryptoModule = await import('node:crypto');
	return cryptoModule.createHmac('sha256', secret).update(value).digest('base64url');
}

async function randomId() {
	const cryptoModule = await import('node:crypto');
	return cryptoModule.randomUUID();
}

function base64urlEncode(value: string) {
	const encoder = new TextEncoder();
	return Buffer.from(encoder.encode(value)).toString('base64url');
}
