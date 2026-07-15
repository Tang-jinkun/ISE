import { AssetCatalogController } from './asset-catalog.controller';

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
});
