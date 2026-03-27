import { NextRequest, NextResponse } from 'next/server';
import { shouldProxyToMock } from '@/lib/mock-server-store';

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!shouldProxyToMock(pathname)) {
    return NextResponse.next();
  }

  const rewriteUrl = request.nextUrl.clone();
  rewriteUrl.pathname = `/api/mock${pathname.replace(/^\/mock-api/, '')}`;
  rewriteUrl.search = search;

  return NextResponse.rewrite(rewriteUrl);
}

export const config = {
  matcher: ['/mock-api/:path*'],
};
