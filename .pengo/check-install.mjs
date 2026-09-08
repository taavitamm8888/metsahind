/** Local-only static integration test. No network, Git writes or production deploys. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
	cp,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	writeFile,
	realpath
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { articleBody, buildStaticSite, hash } from './build.mjs';

async function filesIn(root, prefix = '') {
	const files = [];
	for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
		const relative = path.join(prefix, entry.name);
		if (entry.isSymbolicLink())
			throw new Error('Review source symlinks before static installation.');
		if (entry.isDirectory()) files.push(...(await filesIn(root, relative)));
		else if (entry.isFile()) files.push(relative);
	}
	return files.sort();
}

export async function checkInstall(root) {
	root = path.resolve(root);
	assert.ok((await lstat(root)).isDirectory(), 'Use the actual customer repository directory.');
	const manifest = JSON.parse(await readFile(path.join(root, '.pengo/config.json'), 'utf8'));
	assert.ok(!String(manifest.siteId).includes('REPLACE'), 'Replace the example site ID.');
	assert.ok(
		!new URL(manifest.siteUrl).hostname.endsWith('example.com'),
		'Replace the example origin.'
	);
	const template = await readFile(path.join(root, '.pengo/template.html'), 'utf8');
	for (const marker of ['<!-- PENGO_HEAD -->', '<!-- PENGO_BODY -->'])
		assert.equal(template.split(marker).length, 2, `Template needs exactly one ${marker}`);

	const scratch = await mkdtemp(path.join(tmpdir(), 'pengo-install-check-'));
	const snapshot = path.join(scratch, 'website');
	const excludedDirectories = new Set(['node_modules', 'connectors', 'scripts']);
	// Never copy account state, credentials or Git internals into the local fixture.
	await cp(root, snapshot, {
		recursive: true,
		errorOnExist: true,
		force: false,
		filter: async (source) => {
			const relative = path.relative(root, source);
			if (!relative) return true;
			const segments = relative.split(path.sep);
			if (
				segments.some((segment) => excludedDirectories.has(segment)) ||
				segments.some(
					(segment) => segment.startsWith('.') && !['.pengo', '.well-known'].includes(segment)
				)
			)
				return false;
			if ((await lstat(source)).isSymbolicLink()) throw new Error('Review source symlinks first.');
			return true;
		}
	});
	const inventory = await filesIn(snapshot);
	const baseline = await buildStaticSite({ root: snapshot, output: '.pengo-check-baseline' });
	const baselineFiles = await filesIn(baseline.output);
	const indexPath = path.join(manifest.blogPath.slice(1), 'index.html');
	const omitted = [];
	let preserved = 0;
	for (const file of inventory.filter((file) => !file.startsWith('.pengo' + path.sep))) {
		if (!baselineFiles.includes(file)) {
			omitted.push(file);
			continue;
		}
		if ([indexPath, 'robots.txt'].includes(file)) continue;
		assert.deepEqual(
			await readFile(path.join(snapshot, file)),
			await readFile(path.join(baseline.output, file)),
			`Original public file changed: ${file}`
		);
		preserved++;
	}
	const proof = JSON.parse(
		await readFile(path.join(baseline.output, '.well-known/pengo.json'), 'utf8')
	);
	const normalized = Object.fromEntries(
		['version', 'siteId', 'siteUrl', 'branch', 'blogPath', 'assetPath', 'format'].map((key) => [
			key,
			manifest[key]
		])
	);
	assert.deepEqual(proof, {
		version: 1,
		siteId: manifest.siteId,
		manifestHash: hash(JSON.stringify(normalized))
	});
	const slug = `pengo-install-test-${randomUUID().slice(0, 8)}`;
	const image = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1cAAAAASUVORK5CYII=',
		'base64'
	);
	const filename = `${hash(image)}.png`;
	const data = {
		version: 1,
		siteId: manifest.siteId,
		articleId: 'local-install-test',
		articleVersionId: 'local-install-test-v1',
		idempotencyKey: 'local-only-never-publish',
		slug,
		title: 'LOCAL INSTALL TEST — DO NOT PUBLISH',
		seoTitle: null,
		description: 'Local publishing integration fixture.',
		excerpt: 'Local fixture only; not a real customer article.',
		contentHtml:
			'<p>Local integration test.</p><p><a href="/" data-oros-cta-id="local-test">Home</a></p>',
		locale: 'et-EE',
		url: new URL(`${manifest.blogPath}${slug}/`, manifest.siteUrl).href,
		image: { filename, alt: 'Local one-pixel fixture' },
		publishedAt: 1788825600000,
		modifiedAt: 1788825600000
	};
	const article = { ...data, contentHash: hash(JSON.stringify(data)) };
	await mkdir(path.join(snapshot, '.pengo/articles'), { recursive: true });
	await mkdir(path.join(snapshot, '.pengo/assets'), { recursive: true });
	await writeFile(path.join(snapshot, '.pengo/articles', `${slug}.json`), JSON.stringify(article), {
		flag: 'wx'
	});
	// Identical content-addressed image can already exist; preserve that copy.
	try {
		await writeFile(path.join(snapshot, '.pengo/assets', filename), image, { flag: 'wx' });
	} catch (error) {
		if (error.code !== 'EEXIST') throw error;
		assert.deepEqual(await readFile(path.join(snapshot, '.pengo/assets', filename)), image);
	}
	const withFixture = await buildStaticSite({ root: snapshot, output: '.pengo-check-fixture' });
	assert.equal(withFixture.articles, baseline.articles + 1);
	for (const file of baselineFiles.filter(
		(file) => ![indexPath, 'pengo-sitemap.xml'].includes(file)
	))
		assert.deepEqual(
			await readFile(path.join(baseline.output, file)),
			await readFile(path.join(withFixture.output, file)),
			`Existing output changed after adding an article: ${file}`
		);
	const html = await readFile(
		path.join(withFixture.output, manifest.blogPath, slug, 'index.html'),
		'utf8'
	);
	assert.ok(html.includes(articleBody(article)), 'Exact article wrapper and body must survive.');
	assert.equal(
		(html.match(/data-pengo-article=/g) ?? []).length,
		1,
		'Exactly one article wrapper.'
	);
	assert.ok(html.includes(`rel="canonical" href="${article.url}"`), 'Expected canonical missing.');
	assert.equal(
		(html.match(/rel=["']canonical["']/gi) ?? []).length,
		1,
		'Remove inherited canonical tags.'
	);
	assert.equal((html.match(/<title[\s>]/gi) ?? []).length, 1, 'Remove inherited title tags.');
	assert.equal((html.match(/<h1[\s>]/gi) ?? []).length, 1, 'Remove inherited article H1.');
	assert.ok(
		!/<meta[^>]+(?:noindex|\bnone\b)/i.test(html),
		'Production template must not hardcode noindex.'
	);
	assert.deepEqual(await readFile(path.join(withFixture.output, 'pengo-media', filename)), image);
	assert.ok(
		(await readFile(path.join(withFixture.output, indexPath), 'utf8')).includes(article.url)
	);
	assert.ok(
		(await readFile(path.join(withFixture.output, 'pengo-sitemap.xml'), 'utf8')).includes(
			article.url
		)
	);
	assert.ok(
		(await readFile(path.join(withFixture.output, 'robots.txt'), 'utf8')).includes(
			'/pengo-sitemap.xml'
		)
	);
	return {
		result: 'local_checks_pass',
		siteId: manifest.siteId,
		siteUrl: manifest.siteUrl,
		manifestHash: proof.manifestHash,
		originalFilesPreserved: preserved,
		omittedFilesToReview: omitted,
		baselineOutput: baseline.output,
		fixtureOutput: withFixture.output,
		fixtureArticlePath: `${manifest.blogPath}${slug}/`,
		warning:
			'Do not deploy the fixture output. Review omitted files, branding and hosting separately. No live connection or publication was tested.',
		customerSourceModified: false
	};
}

if (
	process.argv[1] &&
	(await realpath(process.argv[1]).catch(() => null)) === fileURLToPath(import.meta.url)
) {
	try {
		const args = process.argv.slice(2);
		assert.ok(
			args.length === 2 && args[0] === '--root',
			'Usage: node .pengo/check-install.mjs --root .'
		);
		console.log(JSON.stringify(await checkInstall(args[1]), null, 2));
	} catch (error) {
		console.error(`Installation check failed: ${error.message}`);
		process.exitCode = 1;
	}
}
