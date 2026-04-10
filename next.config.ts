import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  serverExternalPackages: ['swagger-typescript-api'],
  output: 'standalone'
};

export default nextConfig;
