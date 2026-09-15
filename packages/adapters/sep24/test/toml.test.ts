import { describe, expect, it } from 'vitest';
import { RampError } from '@slipwaykit/core';
import { fetchAnchorToml } from '@slipwaykit/adapter-sep24';
import { fixture, harnessFor, rejection } from './harness.js';

const url = 'https://testanchor.stellar.org/.well-known/stellar.toml';

describe('fetchAnchorToml', () => {
  it('reads every field Slipway acts on from the recorded SDF test anchor', async () => {
    const harness = harnessFor({ [url]: { text: fixture('testanchor.stellar.org.toml') } });

    const toml = await fetchAnchorToml('testanchor.stellar.org', harness.fetch);

    expect(toml.homeDomain).toBe('testanchor.stellar.org');
    expect(toml.transferServer).toBe('https://testanchor.stellar.org/sep24');
    expect(toml.webAuthEndpoint).toBe('https://testanchor.stellar.org/auth');
    expect(toml.quoteServer).toBe('https://testanchor.stellar.org/sep38');
    expect(toml.kycServer).toBe('https://testanchor.stellar.org/sep12');
    expect(toml.orgName).toBe('Stellar Development Foundation');
  });

  it('reads the CURRENCIES array, including the issuerless native entry', async () => {
    const harness = harnessFor({ [url]: { text: fixture('testanchor.stellar.org.toml') } });

    const toml = await fetchAnchorToml('testanchor.stellar.org', harness.fetch);

    expect(toml.currencies.map((c) => c.code)).toEqual(['SRT', 'USDC', 'native']);
    expect(toml.currencies[1]).toMatchObject({
      code: 'USDC',
      issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      status: 'test',
      isAssetAnchored: false,
    });
    expect(toml.currencies[2]?.issuer).toBeUndefined();
  });

  it('reads an anchored currency with its anchor_asset', async () => {
    const harness = harnessFor({
      'https://pegged.example.com/.well-known/stellar.toml': {
        text: fixture('pegged-anchor.toml'),
      },
    });

    const toml = await fetchAnchorToml('pegged.example.com', harness.fetch);

    expect(toml.currencies[0]).toMatchObject({
      code: 'NGNC',
      isAssetAnchored: true,
      anchorAsset: 'NGN',
    });
    expect(toml.quoteServer).toBeUndefined();
    expect(toml.kycServer).toBeUndefined();
  });

  it('strips a trailing slash so URLs never double up', async () => {
    const harness = harnessFor({
      'https://ngn.example.com/.well-known/stellar.toml': { text: fixture('ngn-anchor.toml') },
    });

    const toml = await fetchAnchorToml('ngn.example.com', harness.fetch);

    // The fixture deliberately publishes TRANSFER_SERVER_SEP0024 with a slash.
    expect(toml.transferServer).toBe('https://ngn.example.com/sep24');
  });

  it('tolerates a scheme or a trailing slash on the configured domain', async () => {
    const harness = harnessFor({ [url]: { text: fixture('testanchor.stellar.org.toml') } });

    const toml = await fetchAnchorToml('https://testanchor.stellar.org/', harness.fetch);

    expect(toml.homeDomain).toBe('testanchor.stellar.org');
    expect(harness.calls[0]).toBe(url);
  });

  it('reports an unreachable domain as retryable', async () => {
    const harness = harnessFor({
      [url]: { throws: new TypeError('fetch failed') },
    });

    await expect(fetchAnchorToml('testanchor.stellar.org', harness.fetch)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });
  });

  it('reports a 500 as retryable', async () => {
    const harness = harnessFor({ [url]: { status: 503, text: 'maintenance' } });

    await expect(fetchAnchorToml('testanchor.stellar.org', harness.fetch)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });
  });

  it('reports invalid TOML as retryable, keeping the parser message as evidence', async () => {
    const harness = harnessFor({ [url]: { text: 'this = = not toml' } });

    const error = await rejection(fetchAnchorToml('testanchor.stellar.org', harness.fetch));

    expect(error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('not valid TOML');
    expect(error.providerDetail).toBeDefined();
  });

  it('reports an empty TOML as retryable', async () => {
    const harness = harnessFor({ [url]: { text: '   ' } });

    await expect(fetchAnchorToml('testanchor.stellar.org', harness.fetch)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });
  });

  it('reports a valid TOML with no SEP-24 server as NOT retryable', async () => {
    // The domain is up and simply does not do SEP-24. Retrying that every
    // fifteen minutes forever is noise, not resilience.
    const harness = harnessFor({
      [url]: { text: 'VERSION = "2.0.0"\nWEB_AUTH_ENDPOINT = "https://x/auth"\n' },
    });

    const error = await rejection(fetchAnchorToml('testanchor.stellar.org', harness.fetch));

    expect(error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('does not support SEP-24');
  });

  it('refuses an empty home domain without making a request', async () => {
    const harness = harnessFor({});

    await expect(fetchAnchorToml('   ', harness.fetch)).rejects.toBeInstanceOf(RampError);
    expect(harness.calls).toEqual([]);
  });

  it('ignores a CURRENCIES entry with no code rather than failing the anchor', async () => {
    const harness = harnessFor({
      [url]: {
        text: [
          'TRANSFER_SERVER_SEP0024 = "https://x/sep24"',
          '[[CURRENCIES]]',
          'issuer = "GABC"',
          '[[CURRENCIES]]',
          'code = "USDC"',
          'issuer = "GDEF"',
        ].join('\n'),
      },
    });

    const toml = await fetchAnchorToml('testanchor.stellar.org', harness.fetch);

    expect(toml.currencies).toHaveLength(1);
    expect(toml.currencies[0]?.code).toBe('USDC');
  });
});
