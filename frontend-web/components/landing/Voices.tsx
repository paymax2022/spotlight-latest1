'use client';

import Link from 'next/link';
import { useRef, useState, type RefObject } from 'react';
import { COMMUNITY_IMG, videos, type Video } from './content';
import { useModalDialog } from './useModalDialog';

/**
 * Shout-out clips only, never a still dressed up as one. Nothing in the
 * reviewed source pages could be played, so this renders the empty state the
 * mock designed — and the real grid the moment a URL is added to `videos`.
 */
export default function Voices() {
  return (
    <section className="voices wrap" id="shoutouts" aria-labelledby="voices-title">
      <div className="section-head">
        <div>
          <p className="eyebrow">05 / STRAIGHT FROM THE SOURCE</p>
          <h2 id="voices-title">
            The voices.
            <br />
            <em>The belief. The Spotlight.</em>
          </h2>
        </div>
        <p className="supporting-copy">
          Video shout-outs and confirmation messages
          <br />
          from entertainers and supporters.
        </p>
      </div>

      {videos.length === 0 ? <NoVideosYet /> : <VideoGrid items={videos} />}
    </section>
  );
}

function NoVideosYet() {
  return (
    <div className="video-empty">
      <div className="video-empty-poster">
        <img
          src={`${COMMUNITY_IMG}/shape-cover.webp`}
          alt="Spotlight stage performance photograph — not a video thumbnail"
          loading="lazy"
          decoding="async"
        />
        <div className="video-empty-copy">
          <span className="video-status">VIDEO COLLECTION / COMING SOON</span>
          <h3>{'Their words.\nTheir support.'}</h3>
          <p>Official shout-outs and confirmation videos will appear here.</p>
        </div>
      </div>
      <div className="video-empty-aside">
        <span className="eyebrow">VOICES OF THE SPOTLIGHT COMMUNITY</span>
        <div className="video-editorial-row">
          <span>01</span>
          <div>
            <h4>Entertainer shout-outs</h4>
            <p>Messages from across music, comedy and film.</p>
          </div>
        </div>
        <div className="video-editorial-row">
          <span>02</span>
          <div>
            <h4>Supporter confirmations</h4>
            <p>Hear directly from the people behind the programme.</p>
          </div>
        </div>
        <Link className="text-link" href="/media-room">
          Visit the media room <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </div>
  );
}

function VideoGrid({ items }: { items: Video[] }) {
  const [playerOpen, setPlayerOpen] = useState(false);
  const [videoIndex, setVideoIndex] = useState(0);
  const opener = useRef<HTMLElement | null>(null);

  return (
    <>
      <div className="video-card-grid">
        {items.map((video, index) => (
          <article className="video-card" key={video.url}>
            <img src={video.poster} alt={video.person || video.title} loading="lazy" decoding="async" />
            <div className="video-card-copy">
              <span className="eyebrow">{video.category}</span>
              <h3>{video.title}</h3>
              <p>{video.person}</p>
              {isPlayableMp4(video.url) ? (
                <button
                  type="button"
                  className="button light"
                  onClick={(event) => {
                    opener.current = event.currentTarget;
                    setVideoIndex(index);
                    setPlayerOpen(true);
                  }}
                >
                  Watch video <span aria-hidden="true">↗</span>
                </button>
              ) : (
                <a className="button light" href={video.url} target="_blank" rel="noopener noreferrer">
                  Watch official video <span aria-hidden="true">↗</span>
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
      <VideoPlayer
        open={playerOpen}
        video={items[videoIndex]}
        onClose={() => setPlayerOpen(false)}
        opener={opener}
      />
    </>
  );
}

/** Local and HTTPS MP4s can be played here; anything else is an external watch page. */
function isPlayableMp4(url: string): boolean {
  return /\.mp4(?:[?#]|$)/i.test(url);
}

function VideoPlayer({
  open,
  video,
  onClose,
  opener,
}: {
  open: boolean;
  video: Video;
  onClose: () => void;
  opener: RefObject<HTMLElement | null>;
}) {
  const { ref, onSelfClick } = useModalDialog(open, onClose, opener);

  return (
    <dialog
      ref={ref}
      className="media-dialog"
      aria-labelledby="video-dialog-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onSelfClick();
      }}
    >
      <div className="media-dialog-bar">
        <p id="video-dialog-title">{video.title}</p>
        <button type="button" aria-label="Close video player" onClick={onClose}>
          ×
        </button>
      </div>
      <div>
        {/* .media-dialog video carries the player's own rules. Only mounted while
            the dialog is open, so closing it stops playback and the download. */}
        {open ? (
          <video controls preload="metadata" src={video.url} poster={video.poster}>
            {video.captions ? <track kind="captions" src={video.captions} srcLang="en" label="English" default /> : null}
          </video>
        ) : null}
      </div>
    </dialog>
  );
}
