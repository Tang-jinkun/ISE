import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResourcePanel } from './ResourcePanel';
import {
  canonicalSceneConfig,
  sceneConfigWithUnsupportedAudio
} from './sceneConfig.testData';

describe('ResourcePanel', () => {
  it('shows metadata and counts for every canonical track type', () => {
    render(
      <ResourcePanel
        sceneConfig={canonicalSceneConfig}
        diagnostics={canonicalSceneConfig.diagnostics}
      />
    );

    expect(screen.getByText('document-1')).toBeInTheDocument();
    expect(screen.getByText('Track metadata warning')).toBeInTheDocument();
    for (const label of ['字幕', '图片', '视频', '标注', '地理', '镜头', '模型']) {
      expect(screen.getByTitle(label)).toHaveTextContent('1');
    }
  });

  it('ignores unsupported legacy track types', () => {
    render(
      <ResourcePanel
        sceneConfig={sceneConfigWithUnsupportedAudio}
        diagnostics={[]}
      />
    );

    expect(screen.queryByTitle('音频')).not.toBeInTheDocument();
  });
});
