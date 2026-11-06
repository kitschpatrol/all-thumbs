import { eslintConfig } from '@kitschpatrol/eslint-config'

export default eslintConfig({
	ignores: ['archive/*', '**/changelog.md'],
	type: 'lib',
})
