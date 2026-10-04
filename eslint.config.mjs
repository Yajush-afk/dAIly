import js from '@eslint/js'
import ts from 'typescript-eslint'
import hooks from 'eslint-plugin-react-hooks'

export default ts.config(
  { ignores: ['out/**', 'release/**', 'node_modules/**', 'coverage/**', 'artifacts/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { files: ['**/*.tsx'], plugins: { 'react-hooks': hooks }, rules: hooks.configs.recommended.rules },
  { rules: { '@typescript-eslint/no-explicit-any': 'error' } }
)
