import type {EditorAPI} from 'texelune-editor';

export async function mountStatic(container: HTMLElement): Promise<EditorAPI> {
  const moduleUrl = '/component/index.js';
  const {createEditor} = await import(/* @vite-ignore */ moduleUrl) as typeof import('texelune-editor');
  return createEditor(container, {value: 'Static ESM component'});
}
