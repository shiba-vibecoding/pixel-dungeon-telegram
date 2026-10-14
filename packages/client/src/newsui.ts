import { audio } from './audio';
import { lang, t } from './i18n';
import { type MainIcon, RELEASES, type Release, type Words } from './releases';
import { button, el, info, show, windowOf } from './screens';

/*
 * «Что нового» (design system v20, components/ReleaseNews): the usual window is a list with a tag on each line
 * (added / now / fixed / balance); a major update's is the big one, with the banner of six heroes by the fire
 * (banner-whatsnew.png) and four main items, its other changes behind «All changes». «Play» and the cross both
 * record that the version was seen (the caller does, in `onClose`).
 */

const words = (w: Words): string => w[lang === 'ru' ? 'ru' : 'en'];

/** The icon of a main item: the classes' two portraits, a talent star, the alchemy pot, a skull. */
function mainIcon(icon: MainIcon): HTMLElement {
  if (icon === 'classes') {
    const faces = el('span', { className: 'pd-news-faces' });
    for (const av of [4, 5]) {
      const face = el('i');
      face.style.setProperty('--av', String(av));
      faces.append(face);
    }
    return faces;
  }
  const sprite = icon === 'talents' ? ['talent', 26] : icon === 'alchemy' ? ['alchemy', 32] : ['skull', 28];
  const node = el('i', { className: 'pd-icon' });
  node.style.cssText = `width:${sprite[1]}px;height:${sprite[1]}px;background-image:var(--spr-${sprite[0]})`;
  return node;
}

/** The list of changes with their tags. */
function changesList(release: Release): HTMLElement {
  return el(
    'ul',
    { className: 'pd-news-list' },
    ...release.changes.map((change) => el('li', {}, el('span', { className: `pd-news-tag ${change.tag}`, textContent: t.rel.news.tags[change.tag] }), el('span', { textContent: words(change.text) }))),
  );
}

export interface NewsOptions {
  release: Release;
  /** «Play» or the cross: the window is done with. */
  onClose(): void;
}

/** Every change of one release, in a scrolling list; «Back» returns to where it came from. */
function showAll(release: Release, back: () => void): void {
  const heading = t.rel.news.version(release.version);
  show(
    windowOf(
      { title: t.rel.news.all, sub: heading, onClose: back, className: 'pd-news' },
      el('div', { className: 'pd-scroll' }, changesList(release)),
      el('div', { className: 'pd-actions' }, button(t.rel.news.back, back, 'primary')),
    ),
    back,
  );
}

/** The earlier versions' changes, newest first, under their versions. */
function showHistory(back: () => void): void {
  const older = RELEASES.slice(1);
  show(
    windowOf(
      { title: t.rel.news.earlier, onClose: back, className: 'pd-news' },
      el('div', { className: 'pd-scroll' }, ...older.map((release) => el('section', {}, el('h3', { className: 'pd-heading', textContent: t.rel.news.version(release.version) }), changesList(release)))),
      el('div', { className: 'pd-actions' }, button(t.rel.news.back, back, 'primary')),
    ),
    back,
  );
}

/** The news window. */
export function showNews(options: NewsOptions): void {
  const { release } = options;
  const open = (): void => showNews(options);
  audio.play('gold', 0.9, 0.3);
  if (release.major && release.main) {
    const more = Math.max(0, release.changes.length - release.main.length);
    show(
      el(
        'section',
        { className: 'pd-window pd-news big', role: 'dialog', ariaLabel: `${t.rel.news.title} · ${release.title ? words(release.title) : ''}` },
        el(
          'div',
          { className: 'pd-news-banner', role: 'img', ariaLabel: t.rel.news.bannerAlt },
          el('span', { className: 'pd-news-kick', textContent: `${release.kick ? words(release.kick) : ''} · ${t.rel.news.version(release.version)}` }),
          el('b', { textContent: release.title ? words(release.title) : '' }),
        ),
        release.sub ? el('p', { className: 'pd-news-sub', textContent: words(release.sub) }) : null,
        release.notice ? el('p', { className: 'pd-news-notice', role: 'note', textContent: words(release.notice) }) : null,
        el(
          'ul',
          { className: 'pd-news-big' },
          ...release.main.map((item) => el('li', {}, el('span', { className: 'pd-news-ico' }, mainIcon(item.icon)), el('span', {}, el('b', { textContent: words(item.title) }), words(item.text)))),
        ),
        el(
          'div',
          { className: 'pd-actions' },
          button(t.rel.news.play, options.onClose, 'primary big'),
          button(t.rel.news.allMore(more), () => showAll(release, open), 'quiet'),
        ),
      ),
      options.onClose,
    );
    return;
  }
  const older = RELEASES.length > 1;
  show(
    windowOf(
      { title: t.rel.news.title, sub: t.rel.news.version(release.version), onClose: options.onClose, className: 'pd-news' },
      el('div', { className: 'pd-scroll' }, changesList(release)),
      el('div', { className: 'pd-actions' }, button(t.rel.news.play, options.onClose, 'primary'), older ? button(t.rel.news.all, () => showHistory(open), 'quiet') : null),
      info(t.rel.news.once, 'pd-note center'),
    ),
    options.onClose,
  );
}
