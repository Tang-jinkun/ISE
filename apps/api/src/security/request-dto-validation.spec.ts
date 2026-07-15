import { ValidationPipe } from '@nestjs/common';
import { FileController } from '../modules/file/file.controller';
import { CreateScriptDto } from '../modules/script/dto/create-script.dto';
import { UpdateScriptDto } from '../modules/script/dto/update-script.dto';

jest.mock('../modules/file/file.service', () => ({ FileService: class FileService {} }));
jest.mock('@/utils', () => ({ responseMessage: jest.fn() }), { virtual: true });

describe('strict request DTO compatibility', () => {
  const pipe = new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  });

  it('preserves legitimate multipart upload fields', async () => {
    const parameterTypes = Reflect.getMetadata(
      'design:paramtypes',
      FileController.prototype,
      'upload',
    );
    const uploadBodyType = parameterTypes[1];

    const result = await pipe.transform(
      { folderId: 'owned-folder', fileType: 'video' },
      { type: 'body', metatype: uploadBodyType },
    );

    expect(result).toEqual({ folderId: 'owned-folder', fileType: 'video' });
  });

  it('preserves legitimate file-list query fields', async () => {
    const parameterTypes = Reflect.getMetadata(
      'design:paramtypes',
      FileController.prototype,
      'list',
    );
    const listQueryType = parameterTypes[0];

    const result = await pipe.transform(
      { folderId: 'owned-folder', fileType: 'image' },
      { type: 'query', metatype: listQueryType },
    );

    expect(result).toEqual({ folderId: 'owned-folder', fileType: 'image' });
  });

  it('preserves script config and conversation when creating a script', async () => {
    const conversation = [{ role: 'user', content: 'Build the scene' }];
    const result = await pipe.transform(
      {
        title: 'Scene script',
        config: '{"tracks":[]}',
        type: 'default',
        conversation,
      },
      { type: 'body', metatype: CreateScriptDto },
    );

    expect(result).toMatchObject({ config: '{"tracks":[]}', conversation });
  });

  it('keeps the existing title-only script creation request valid', async () => {
    const result = await pipe.transform(
      { title: 'Untitled script' },
      { type: 'body', metatype: CreateScriptDto },
    );

    expect(result).toMatchObject({ title: 'Untitled script' });
  });

  it('preserves script config and conversation when updating a script', async () => {
    const conversation = [{ role: 'assistant', content: 'Updated' }];
    const result = await pipe.transform(
      { config: '{"tracks":[1]}', conversation },
      { type: 'body', metatype: UpdateScriptDto },
    );

    expect(result).toMatchObject({ config: '{"tracks":[1]}', conversation });
  });
});
