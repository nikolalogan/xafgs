import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  output: 'standalone',
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    '*.local',
    '*.lan',
    '*.home.arpa',
    '10.*.*.*',
    '172.16.*.*',
    '172.17.*.*',
    '172.18.*.*',
    '172.19.*.*',
    '172.20.*.*',
    '172.21.*.*',
    '172.22.*.*',
    '172.23.*.*',
    '172.24.*.*',
    '172.25.*.*',
    '172.26.*.*',
    '172.27.*.*',
    '172.28.*.*',
    '172.29.*.*',
    '172.30.*.*',
    '172.31.*.*',
    '192.168.*.*',
  ],
  webpack: config => {
    config.resolve = config.resolve ?? {}
    config.resolve.alias = config.resolve.alias ?? {}
    config.resolve.alias['@univerjs/sheets-formula-ui'] = path.resolve(
      __dirname,
      'node_modules/@univerjs/sheets-formula-ui/lib/index.js',
    )
    return config
  },
}

export default nextConfig
