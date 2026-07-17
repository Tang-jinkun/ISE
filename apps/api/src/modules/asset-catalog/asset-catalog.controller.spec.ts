import { AssetCatalogController } from './asset-catalog.controller';
import { Readable } from 'stream';

jest.mock('@/utils', () => ({ responseMessage: jest.fn((data: unknown) => ({ data })) }), {
  virtual: true,
});
jest.mock('./asset-catalog.service', () => ({ AssetCatalogService: class AssetCatalogService {} }));

const { responseMessage } = jest.requireMock('@/utils') as { responseMessage: jest.Mock };

describe('AssetCatalogController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('wraps the public catalog without adding storage paths', () => {
    const entries = [{ assetId: 'model:jf17', kind: 'model' }];
    const service = {
      listPublic: jest.fn().mockReturnValue(entries),
      createAccess: jest.fn(),
    };
    const controller = new AssetCatalogController(service as any);

    expect(controller.list()).toEqual({ data: entries });
    expect(responseMessage).toHaveBeenCalledWith(entries);
  });

  it('wraps signed access resolved by asset id', async () => {
    const access = { assetId: 'model:jf17', url: 'https://minio.test/signed' };
    const service = {
      listPublic: jest.fn(),
      createAccess: jest.fn().mockResolvedValue(access),
    };
    const controller = new AssetCatalogController(service as any);

    await expect(controller.access('model:jf17')).resolves.toEqual({ data: access });
    expect(service.createAccess).toHaveBeenCalledWith('model:jf17');
    expect(responseMessage).toHaveBeenCalledWith(access);
  });

  it('streams asset content with identity headers through the authenticated API origin', async () => {
    const stream = Readable.from(['trajectory']);
    const entry = {
      assetId: 'trajectory:route', kind: 'trajectory', objectName: 'private/route.json',
      fingerprint: `sha256:${'1'.repeat(64)}`, size: 10,
      mediaType: 'application/vnd.ise.trajectory+json',
      trajectory: { startTimeMs: 0, endTimeMs: 1_000 },
    };
    const service = {
      listPublic: jest.fn(), createAccess: jest.fn(),
      openContent: jest.fn().mockResolvedValue({ entry, stream }),
    };
    const setHeader = jest.fn();
    const controller = new AssetCatalogController(service as any);

    const result = await controller.content('trajectory:route', { setHeader } as any);

    expect(service.openContent).toHaveBeenCalledWith('trajectory:route');
    expect(setHeader).toHaveBeenCalledWith('x-asset-id', entry.assetId);
    expect(setHeader).toHaveBeenCalledWith('x-content-sha256', entry.fingerprint);
    expect(setHeader).toHaveBeenCalledWith('x-trajectory-start-ms', '0');
    expect(setHeader).toHaveBeenCalledWith('x-trajectory-end-ms', '1000');
    expect(result).toEqual(expect.objectContaining({ options: expect.objectContaining({ length: 10 }) }));
  });
});
