import { NextResponse } from 'next/server';

export function middleware(request) {
    // Get the pathname of the request (e.g. /api/products)
    const path = request.nextUrl.pathname;

    // Add CORS headers
    const response = NextResponse.next();
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.headers.set(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
    );

    // Handle OPTIONS request
    if (request.method === 'OPTIONS') {
        return new NextResponse(null, { status: 200, headers: response.headers });
    }

    // Allow all API routes
    if (path.startsWith('/api/')) {
        return response;
    }

    // Continue the request
    return response;
}

export const config = {
    matcher: ['/api/:path*']
}; 