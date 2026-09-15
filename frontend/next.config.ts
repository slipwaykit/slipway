import type { NextConfig } from 'next';

const config: NextConfig = {
  // The core package ships ES2022 from its own build; let Next compile it into
  // the browser bundle like first-party code.
  transpilePackages: ['@slipwaykit/core'],
  reactStrictMode: true,
  poweredByHeader: false,
};

export default config;
