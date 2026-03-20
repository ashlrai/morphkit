import { describe, test, expect, beforeAll } from 'bun:test';
import { Project } from 'ts-morph';

import {
  createProject,
  parseFile,
  extractTypeDefinitions,
  extractFunctionComponents,
  extractHookUsage,
} from '../../src/analyzer/ast-parser';

describe('AST Parser', () => {
  let project: Project;

  beforeAll(() => {
    project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        jsx: 4, // JsxEmit.ReactJSX
        esModuleInterop: true,
        target: 99, // ScriptTarget.Latest
        module: 99, // ModuleKind.ESNext
      },
    });
  });

  describe('extractTypeDefinitions', () => {
    test('extracts interfaces', () => {
      const sourceFile = project.createSourceFile(
        'types.ts',
        `
        export interface User {
          id: string;
          name: string;
          email: string;
          age?: number;
        }
        `,
        { overwrite: true },
      );

      const types = extractTypeDefinitions(sourceFile);
      expect(types.length).toBe(1);
      expect(types[0].name).toBe('User');
      expect(types[0].properties.length).toBe(4);
      expect(types[0].properties[0].name).toBe('id');
      expect(types[0].properties[3].isOptional).toBe(true);
    });

    test('extracts type aliases', () => {
      const sourceFile = project.createSourceFile(
        'types2.ts',
        `
        export type Status = 'active' | 'inactive' | 'pending';
        export type UserWithPosts = User & { posts: Post[] };
        `,
        { overwrite: true },
      );

      const types = extractTypeDefinitions(sourceFile);
      expect(types.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('extractFunctionComponents', () => {
    test('extracts arrow function component', () => {
      const sourceFile = project.createSourceFile(
        'Button.tsx',
        `
        import React from 'react';

        interface ButtonProps {
          label: string;
          onClick: () => void;
          variant?: 'primary' | 'secondary';
        }

        export const Button: React.FC<ButtonProps> = ({ label, onClick, variant = 'primary' }) => {
          return (
            <button className={\`btn btn-\${variant}\`} onClick={onClick}>
              {label}
            </button>
          );
        };
        `,
        { overwrite: true },
      );

      const components = extractFunctionComponents(sourceFile);
      expect(components.length).toBe(1);
      expect(components[0].name).toBe('Button');
    });

    test('extracts function declaration component', () => {
      const sourceFile = project.createSourceFile(
        'Card.tsx',
        `
        export default function Card({ title, children }: { title: string; children: React.ReactNode }) {
          return (
            <div className="card">
              <h2>{title}</h2>
              <div>{children}</div>
            </div>
          );
        }
        `,
        { overwrite: true },
      );

      const components = extractFunctionComponents(sourceFile);
      expect(components.length).toBe(1);
      expect(components[0].name).toBe('Card');
    });
  });

  describe('extractHookUsage', () => {
    test('extracts useState hooks', () => {
      const sourceFile = project.createSourceFile(
        'Counter.tsx',
        `
        import { useState } from 'react';

        export function Counter() {
          const [count, setCount] = useState(0);
          const [name, setName] = useState<string>('');
          return <div>{count}</div>;
        }
        `,
        { overwrite: true },
      );

      const func = sourceFile.getFunctions()[0];
      if (func) {
        const hooks = extractHookUsage(func);
        const useStateHooks = hooks.filter(h => h.hookName === 'useState');
        expect(useStateHooks.length).toBe(2);
      }
    });

    test('extracts useEffect hooks', () => {
      const sourceFile = project.createSourceFile(
        'Effect.tsx',
        `
        import { useState, useEffect } from 'react';

        export function DataLoader() {
          const [data, setData] = useState(null);

          useEffect(() => {
            fetch('/api/data').then(r => r.json()).then(setData);
          }, []);

          return <div>{data}</div>;
        }
        `,
        { overwrite: true },
      );

      const func = sourceFile.getFunctions()[0];
      if (func) {
        const hooks = extractHookUsage(func);
        const useEffectHooks = hooks.filter(h => h.hookName === 'useEffect');
        expect(useEffectHooks.length).toBe(1);
      }
    });
  });
});
