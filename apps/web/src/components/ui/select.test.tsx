import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './select';

describe('select compatibility components', () => {
  it('keeps unused compatibility wrappers as ordinary function components', () => {
    expect(typeof SelectTrigger).toBe('function');
    expect(typeof SelectValue).toBe('function');
    expect(typeof SelectContent).toBe('function');

    const { container, rerender } = render(
      <>
        <SelectTrigger />
        <SelectValue />
      </>
    );
    expect(container).toBeEmptyDOMElement();

    rerender(
      <SelectContent>
        <span>Compatibility content</span>
      </SelectContent>
    );
    expect(screen.getByText('Compatibility content')).toBeInTheDocument();
  });

  it('continues forwarding refs from Select and SelectItem to native elements', () => {
    const selectRef = createRef<HTMLSelectElement>();
    const itemRef = createRef<HTMLOptionElement>();

    render(
      <Select ref={selectRef} defaultValue="one">
        <SelectItem ref={itemRef} value="one">
          One
        </SelectItem>
      </Select>
    );

    expect(selectRef.current).toBeInstanceOf(HTMLSelectElement);
    expect(itemRef.current).toBeInstanceOf(HTMLOptionElement);
  });
});
