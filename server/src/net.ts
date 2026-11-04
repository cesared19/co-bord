import { HttpError } from './errors.js'

/** The system error code behind a failed fetch, like ENOTFOUND or ECONNREFUSED. */
function errorCode(error: unknown): string | undefined {
	let e = error as { code?: string; cause?: unknown; name?: string } | undefined
	for (let i = 0; e && i < 4; i++) {
		if (e.name === 'TimeoutError') return 'TIMEOUT'
		if (typeof e.code === 'string' && e.code) return e.code
		e = e.cause as typeof e
	}
	return undefined
}

/**
 * A clear message for a service co-bord's server couldn't reach, saying why: an unknown name, nothing listening,
 * no answer in time. `dockerHint` explains the usual fix when the name isn't known (like joining a Docker network).
 */
export function unreachable(service: string, address: string, error: unknown, dockerHint?: string): HttpError {
	let host = address
	try {
		host = new URL(address).host
	} catch {
		/* keep the address */
	}
	const hostname = host.replace(/:\d+$/, '')
	const local = ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
	const base = `${service} can't be reached at ${address}`
	switch (errorCode(error)) {
		case 'ENOTFOUND':
		case 'EAI_AGAIN':
			return new HttpError(
				502,
				`${base}: co-bord's server doesn't know the name ${hostname}.${dockerHint ? ` ${dockerHint}` : ' Check the address.'}`,
			)
		case 'ECONNREFUSED':
			return new HttpError(
				502,
				local
					? `${base}: inside co-bord's container, ${hostname} is the container itself, not the server. Use an address co-bord's server can reach.${dockerHint ? ` ${dockerHint}` : ''}`
					: `${base}: nothing answers at ${host}. Check the address and port, and that ${service} is running.`,
			)
		case 'ECONNRESET':
		case 'EHOSTUNREACH':
		case 'ENETUNREACH':
			return new HttpError(502, `${base}: the network to ${host} is unreachable from co-bord's server. Check firewalls and routes.`)
		case 'TIMEOUT':
		case 'ETIMEDOUT':
		case 'UND_ERR_CONNECT_TIMEOUT':
			return new HttpError(502, `${base}: it didn't answer in time.`)
		case 'CERT_HAS_EXPIRED':
		case 'DEPTH_ZERO_SELF_SIGNED_CERT':
		case 'SELF_SIGNED_CERT_IN_CHAIN':
		case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
		case 'ERR_TLS_CERT_ALTNAME_INVALID':
			return new HttpError(502, `${base}: its HTTPS certificate isn't trusted by co-bord's server.`)
		default:
			return new HttpError(502, base)
	}
}

/** For SparkyTC on the same server: the usual reason co-bord can't find backend-service. */
export const SPARKY_DOCKER_HINT =
	"If SparkyTC runs on this server with Docker, co-bord has to join SparkyTC's Docker network: set COMPOSE_FILE=docker-compose.yml:docker-compose.sparkytc.yml and SPARKYTC_NETWORK (see `docker network ls`) in co-bord's .env, run `docker compose up -d`, and use http://backend-service:8080. See the README, Connecting to SparkyTC on the same server."
