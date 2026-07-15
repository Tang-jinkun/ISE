import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { FileController } from '../modules/file/file.controller';
import { FolderController } from '../modules/folder/folder.controller';
import { CreateScriptDto } from '../modules/script/dto/create-script.dto';
import { UpdateScriptDto } from '../modules/script/dto/update-script.dto';

jest.mock('../modules/file/file.service', () => ({ FileService: class FileService {} }));
jest.mock('../modules/folder/folder.service', () => ({ FolderService: class FolderService {} }));
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

  it('accepts the established withFiles folder-list query field', async () => {
    const parameterTypes = Reflect.getMetadata(
      'design:paramtypes',
      FolderController.prototype,
      'findAll',
    );
    const folderListQueryType = parameterTypes[0];

    const result = await pipe.transform(
      { parentId: 'root', withFiles: 'true' },
      { type: 'query', metatype: folderListQueryType },
    );

    expect(result).toMatchObject({ parentId: 'root', withFiles: true });
  });

  it('still rejects unknown folder-list query fields', async () => {
    const parameterTypes = Reflect.getMetadata(
      'design:paramtypes',
      FolderController.prototype,
      'findAll',
    );
    const folderListQueryType = parameterTypes[0];

    await expect(
      pipe.transform(
        { parentId: 'root', withFiles: 'false', userId: 'attacker-controlled' },
        { type: 'query', metatype: folderListQueryType },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
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
