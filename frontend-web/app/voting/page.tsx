'use client';

import { useState, useEffect } from 'react';
import Layout from '@/components/layout/Layout';
import VoteModal from '@/components/voting/VoteModal';
import { authHeaders } from '@/src/lib/auth/client';
import '@/src/styles/voting.css';
import type { VotePackage, VotingSettings } from '@/src/features/voting/types';

interface Contestant {
  id: string;
  name: string;
  stageName?: string | null;
  category?: string | null;
  state?: string | null;
  photoUrl?: string | null;
  voteCount?: number;
  votePercent?: number;
  rank?: number;
}

interface Contest {
  id: string;
  title: string;
  category: string;
  contestantCount: number;
  totalVotes: number;
  endsAt: string;
  isLive: boolean;
  isTrending: boolean;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(-2)
    .map((word) => word[0])
    .join('');
}

export default function VotingPage() {
  const [contests, setContests] = useState<Contest[]>([]);
  const [activeContest, setActiveContest] = useState<Contest | null>(null);
  const [contestants, setContestants] = useState<Contestant[]>([]);
  const [votePackages, setVotePackages] = useState<VotePackage[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedContestant, setSelectedContestant] = useState<Contestant | null>(null);
  const [isVoteModalOpen, setIsVoteModalOpen] = useState(false);
  // Stays null until /api/v1/contests/[id] answers with the contest's active
  // settings row. The vote modal reads cooldown, paid limits and visibility
  // flags off it, so it gets the real configuration or nothing at all.
  const [votingSettings, setVotingSettings] = useState<VotingSettings | null>(null);
  // Only ever the contest's own per-day allowance; nothing is invented before it
  // arrives. /api/votes/remaining needs both a contestId and the voter's token.
  const [freeVotesRemaining, setFreeVotesRemaining] = useState(0);

  useEffect(() => {
    loadContests();
  }, []);

  useEffect(() => {
    if (activeContest) {
      loadContestants(activeContest.id);
      loadVotePackages(activeContest.id);
      loadVotingSettings(activeContest.id);
      loadFreeVotesRemaining(activeContest.id);
      setSearchQuery('');
      setFeedback('');
      setError('');
    }
  }, [activeContest]);

  const loadFreeVotesRemaining = async (contestId: string) => {
    try {
      // The route answers per-voter, so a contestId is required and the voter's
      // bearer token must ride along: every seeded contest uses the 'user'
      // limit scope, which the service rejects with 401 without one.
      const res = await fetch(`/api/votes/remaining?contestId=${contestId}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json();
      setFreeVotesRemaining(data.freeVotesRemaining ?? 0);
    } catch (err) {
      console.error('Failed to load free votes remaining:', err);
    }
  };

  const loadVotingSettings = async (contestId: string) => {
    try {
      const res = await fetch(`/api/v1/contests/${contestId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.votingSettings) {
          setVotingSettings(data.votingSettings);
        }
      }
    } catch (err) {
      console.error('Failed to load voting settings:', err);
    }
  };

  const loadContests = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/contests');
      if (!res.ok) throw new Error('Failed to load contests');
      const data = await res.json();
      setContests(data);
      if (data.length > 0 && !activeContest) {
        setActiveContest(data[0]);
      }
    } catch (err) {
      setError('Failed to load contests. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadContestants = async (contestId: string) => {
    try {
      const res = await fetch(`/api/v1/contests/${contestId}/contestants`);
      if (!res.ok) throw new Error('Failed to load contestants');
      const data = await res.json();
      setContestants(data);
    } catch (err) {
      setError('Failed to load contestants. Please try again.');
      console.error(err);
    }
  };

  const loadVotePackages = async (contestId: string) => {
    try {
      const res = await fetch(`/api/v1/contests/${contestId}/vote-packages`);
      if (!res.ok) throw new Error('Failed to load vote packages');
      const data = await res.json();
      setVotePackages(data);
    } catch (err) {
      console.error('Failed to load vote packages:', err);
      setVotePackages([]);
    }
  };

  const handleVoteClick = (contestant: Contestant) => {
    if (!activeContest) return;
    
    if (!activeContest.isLive) {
      setError('Voting is closed for this contest.');
      return;
    }

    // isLive already means an active settings row exists, so this only catches
    // a click that lands before that row has come back.
    if (!votingSettings) {
      setError('Voting settings are still loading. Try again in a moment.');
      return;
    }

    setSelectedContestant(contestant);
    setIsVoteModalOpen(true);
  };

  const handleVoteSuccess = (message: string) => {
    setFeedback(message);
    setIsVoteModalOpen(false);
    setSelectedContestant(null);
    if (activeContest) {
      loadContestants(activeContest.id);
      loadContests();
      loadFreeVotesRemaining(activeContest.id);
    }
  };

  const filteredContestants = contestants.filter((contestant) =>
    (contestant.name + ' ' + (contestant.stageName || '') + ' ' + (contestant.category || '') + ' ' + (contestant.state || ''))
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );

  const getVoteButtonText = (contestant: Contestant): string => {
    if (!activeContest?.isLive) return 'Voting closed';
    return 'Vote';
  };

  const isVoteButtonDisabled = (contestant: Contestant): boolean => {
    return !activeContest?.isLive;
  };

  const getToneClass = (index: number): string => {
    if (index === 1) return 'tone-1';
    if (index === 2) return 'tone-2';
    return '';
  };

  if (loading) {
    return (
      <Layout
        headerStyle={1}
        footerStyle={1}
        onePageNav={false}
        breadcrumbTitle={null}
        breadcrumbClassName={undefined}
        breadcrumbPadding={undefined}
      >
        <div className="voting-page">
          <div className="wrap" style={{ padding: '100px 0', textAlign: 'center' }}>
            <p>Loading contests...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (error && contests.length === 0) {
    return (
      <Layout
        headerStyle={1}
        footerStyle={1}
        onePageNav={false}
        breadcrumbTitle={null}
        breadcrumbClassName={undefined}
        breadcrumbPadding={undefined}
      >
        <div className="voting-page">
          <div className="wrap" style={{ padding: '100px 0', textAlign: 'center' }}>
            <p>{error}</p>
            <button className="button primary" onClick={loadContests} style={{ marginTop: '20px' }}>
              Retry
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      headerStyle={1}
      footerStyle={1}
      onePageNav={false}
      breadcrumbTitle={null}
      breadcrumbClassName={undefined}
      breadcrumbPadding={undefined}
    >
      <div className="voting-page">
        {/* Hero Section */}
        <section className="hero">
          <div className="wrap hero-grid">
            <div className="hero-copy">
              <p className="k">
                <i></i> SPOTLIGHT / THE AUDIENCE FLOOR
              </p>
              <h1>
                Back the talent
                <br />
                <em>you believe in.</em>
              </h1>
              <p>Explore the contests, meet the lineup and choose who gets your support.</p>
              <a href="#ballot" className="button primary">
                Explore contests <span aria-hidden="true">↓</span>
              </a>
            </div>
            <figure className="hero-photo">
              <img
                src="/assets/voting/stage.webp"
                alt="A performer holding a microphone in a Spotlight archive image"
                width={1080}
                height={1080}
                fetchPriority="high"
              />
              <figcaption>SPOTLIGHT / PERFORMANCE ARCHIVE</figcaption>
            </figure>
          </div>
        </section>

        {/* Ballot Section */}
        <section id="ballot" className="wrap ballot">
          <div className="section-head">
            <div>
              <p className="k">
                <i></i> 01 / CONTESTS
              </p>
              <h2>Choose your contest.</h2>
            </div>
            <span className="preview">Live voting</span>
          </div>
          <p className="notice">
            Vote for your favorite contestants. One free vote per contest. Vote counts are updated in real-time.
          </p>

          {error && (
            <p className="feedback" style={{ color: '#c8102e', marginTop: '10px' }}>
              {error}
            </p>
          )}

          {/* Contest Picker */}
          <div className="contest-picker" role="group" aria-label="Choose a contest">
            {contests.map((contest, index) => (
              <button
                key={contest.id}
                type="button"
                className="contest"
                aria-pressed={activeContest?.id === contest.id}
                onClick={() => setActiveContest(contest)}
              >
                <span className="number">0{index + 1}</span>
                <strong>{contest.title}</strong>
                <span className="state">
                  {contest.isLive ? 'Voting open' : 'Voting closed'}
                </span>
              </button>
            ))}
          </div>

          {/* Lineup */}
          {activeContest && (
            <div className="lineup">
              <div className="lineup-head">
                <div>
                  <p className="k">{activeContest.category.toUpperCase()}</p>
                  <h3>{activeContest.title}</h3>
                  <p>
                    {activeContest.contestantCount} contestants · {activeContest.totalVotes.toLocaleString()} votes
                    {activeContest.isLive && (
                      <span style={{ color: '#4caf50', marginLeft: '10px' }}>● Live</span>
                    )}
                  </p>
                </div>
                <label>
                  Find a contestant
                  <input
                    type="search"
                    placeholder="Search this lineup"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </label>
              </div>

              <div className="cards">
                {filteredContestants.map((contestant, idx) => (
                  <article key={contestant.id} className="card">
                    <div className={`monogram ${getToneClass(idx)}`} aria-hidden="true">
                      {contestant.photoUrl ? (
                        <img
                          src={contestant.photoUrl}
                          alt={contestant.name}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            position: 'absolute',
                            top: 0,
                            left: 0,
                          }}
                        />
                      ) : (
                        getInitials(contestant.name)
                      )}
                    </div>
                    <div className="card-copy">
                      <p className="discipline">{contestant.category || contestant.state || 'Contestant'}</p>
                      <h4>{contestant.name}</h4>
                      {contestant.voteCount !== undefined && (
                        <p style={{ fontSize: '12px', color: '#67556d', margin: '3px 0 7px' }}>
                          {contestant.voteCount.toLocaleString()} votes
                          {contestant.votePercent !== undefined && ` (${contestant.votePercent}%)`}
                        </p>
                      )}
                      <button
                        type="button"
                        className="button card-vote"
                        disabled={isVoteButtonDisabled(contestant)}
                        aria-label={`${getVoteButtonText(contestant)} · ${contestant.name}`}
                        onClick={() => handleVoteClick(contestant)}
                      >
                        {getVoteButtonText(contestant)}
                      </button>
                    </div>
                  </article>
                ))}
              </div>

              {filteredContestants.length === 0 && (
                <p style={{ textAlign: 'center', padding: '40px 0', color: '#67556d' }}>
                  No contestants match your search.
                </p>
              )}

              {feedback && (
                <p className="feedback" role="status">
                  {feedback}
                </p>
              )}
            </div>
          )}
        </section>

        {/* Guide Section */}
        <section id="how" className="guide">
          <div className="wrap">
            <p className="k">
              <i></i> 02 / THE BALLOT
            </p>
            <h2>From lineup to vote.</h2>
            <ol>
              <li>
                <span>01</span>
                <h3>Pick a contest</h3>
                <p>Open a contest to see its status, vote count, and contestant lineup.</p>
              </li>
              <li>
                <span>02</span>
                <h3>Choose your favourite</h3>
                <p>Find a contestant by name and select the vote button on their card.</p>
              </li>
              <li>
                <span>03</span>
                <h3>Review and confirm</h3>
                <p>
                  Check the name and contest before confirming. One free vote per contest per browser.
                </p>
              </li>
            </ol>
            <a className="text-link" href="https://www.spotlightng.com/voting">
              Read Spotlight's official voting guidance
            </a>
            <div className="official-links">
              <a href="https://www.spotlightng.com/open-mic">Official Open Mic voting</a>
              <a href="https://www.spotlightng.com/talent-vault">Official Talent Vault</a>
              <a href="https://www.spotlightng.com/terms-and-conditions">Voting terms</a>
            </div>
          </div>
        </section>

        {/* Vote Modal */}
        {activeContest && selectedContestant && isVoteModalOpen && votingSettings && (
          <VoteModal
            onClose={() => {
              setIsVoteModalOpen(false);
              setSelectedContestant(null);
            }}
            contestId={activeContest.id}
            contestantId={selectedContestant.id}
            contestantName={selectedContestant.name}
            contestantPhoto={selectedContestant.photoUrl}
            contestName={activeContest.title}
            packages={votePackages}
            settings={votingSettings}
            freeVotesRemaining={freeVotesRemaining}
            onVoteSuccess={handleVoteSuccess}
          />
        )}
      </div>
    </Layout>
  );
}
