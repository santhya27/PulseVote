import { useEffect, useState } from 'react';
import {
  Plus, Copy, LogIn, LogOut, Radio, Vote,
  ArrowUpRight, Check, BarChart3, Users,
  Clock3, Sparkles, ChevronLeft
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'https://pulsevote-r8mu.onrender.com';
const tokenKey = 'pulsevote_token';

async function request(path, opts = {}) {
  const token = localStorage.getItem(tokenKey);

  const res = await fetch(API + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {})
    }
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

function isClosed(p) { return !!p?.expiresAt && new Date(p.expiresAt).getTime() <= Date.now(); }

function formatDate(date) {
  return new Date(date).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

export default function App() {
  const [user, setUser] = useState(() =>
    JSON.parse(localStorage.getItem('pulsevote_user') || 'null')
  );

  const [polls, setPolls] = useState([]);
  const [poll, setPoll] = useState(null);
  const [page, setPage] = useState(location.pathname);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [authMode, setAuthMode] = useState('login');
  const [auth, setAuth] = useState({
    name: '',
    email: '',
    password: ''
  });

  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [expires, setExpires] = useState('');
  const [quiz, setQuiz] = useState(false);
  const [correctOptionId, setCorrectOptionId] = useState('');
  const [analytics, setAnalytics] = useState(null);
  const [quizResult, setQuizResult] = useState(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [presenter, setPresenter] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editQuestion, setEditQuestion] = useState('');
  const [editOptions, setEditOptions] = useState([]);

  const pollId = page.startsWith('/poll/')
    ? page.split('/')[2]
    : null;

  function navigate(path) {
    history.pushState({}, '', path);
    setPage(path);
    setError('');
    setNotice('');
    setPoll(null);
    setSelected('');
    setAnalytics(null);
    setQuizResult(null);
  }

  useEffect(() => {
    const pop = () => {
      setPage(location.pathname);
      setPoll(null);
      setSelected('');
      setError('');
      setNotice('');
    };

    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, []);

  async function loadPolls() {
    try {
      const data = await request('/api/polls');
      setPolls(data);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    loadPolls();
  }, [poll?.totalVotes]);

  useEffect(() => {
    if (!pollId) return;

    let alive = true;

    request('/api/polls/' + pollId)
      .then(p => {
        if (alive) setPoll(p);
      })
      .catch(e => {
        if (alive) setError(e.message);
      });

    const ws = new WebSocket(
      API.replace(/^http/, 'ws') + '/ws/polls/' + pollId
    );

    ws.onmessage = e => {
      try {
        const updated = JSON.parse(e.data);
        if (alive) setPoll(updated);
      } catch {
        // Ignore malformed WebSocket messages.
      }
    };

    ws.onerror = () => {};

    return () => {
      alive = false;
      ws.close();
    };
  }, [pollId]);

  useEffect(() => {
    if (!pollId || !poll) return;
    request(`/api/polls/${pollId}/analytics`)
      .then(setAnalytics)
      .catch(() => {});
  }, [pollId, poll?.totalVotes]);

  async function submitAuth(e) {
    e.preventDefault();
    setError('');

    try {
      const data = await request(
        '/api/auth/' + (authMode === 'signup' ? 'signup' : 'login'),
        {
          method: 'POST',
          body: JSON.stringify(auth)
        }
      );

      localStorage.setItem(tokenKey, data.token);
      localStorage.setItem('pulsevote_user', JSON.stringify(data.user));
      setUser(data.user);
      setNotice('Welcome, ' + data.user.name);
    } catch (e) {
      setError(e.message);
    }
  }

  function logout() {
    localStorage.removeItem(tokenKey);
    localStorage.removeItem('pulsevote_user');
    setUser(null);
    setNotice('You have signed out');
  }

  async function createPoll(e) {
    e.preventDefault();
    setError('');
    setBusy(true);

    try {
      const created = await request('/api/polls', {
        method: 'POST',
        body: JSON.stringify({
          question,
          options: options.filter(x => x.trim()),
          quiz,
          correctOptionId,
          correctAnswer: correctOptionId,
          expiresAt: expires
            ? new Date(expires).toISOString()
            : null
        })
      });

      // Show the new poll immediately on the home page.
      setPolls(previous => [
        created,
        ...previous.filter(p => p.id !== created.id)
      ]);

      // Refresh the authoritative poll list.
      await loadPolls();

      setQuestion('');
      setOptions(['', '']);
      setExpires('');
      setQuiz(false);
      setCorrectOptionId('');

      navigate('/');
      setNotice('Your poll has been published!');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function vote() {
    if (!selected || !pollId) return;

    setBusy(true);
    setError('');

    try {
      const updated = await request(
        `/api/polls/${pollId}/vote`,
        {
          method: 'POST',
          body: JSON.stringify({ optionId: selected })
        }
      );

      setPoll(updated);
      if (updated.quiz) {
        try { setQuizResult(await request(`/api/polls/${pollId}/quiz-result`)); } catch {}
      }
      setNotice('Your vote has been recorded');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

 async function copyLink() {
  const shareUrl = `${window.location.origin}/poll/${pollId}`;

  try {
    // Preferred method: native share on supported mobile devices
    if (navigator.share) {
      await navigator.share({
        title: "Join this PulseVote poll",
        url: shareUrl,
      });
      setNotice("Share link opened");
      return;
    }

    // Fallback: Clipboard API
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(shareUrl);
      setNotice("Share link copied");
      return;
    }

    // Fallback for browsers without Clipboard API support
    const textArea = document.createElement("textarea");
    textArea.value = shareUrl;
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.select();

    const copied = document.execCommand("copy");
    document.body.removeChild(textArea);

    if (copied) {
      setNotice("Share link copied");
    } else {
      setError(`Copy failed. Please copy this link: ${shareUrl}`);
    }
  } catch (error) {
    // A user cancelling the native share sheet is not an error
    if (error.name !== "AbortError") {
      setError(`Unable to share. Copy this link: ${shareUrl}`);
    }
  }
}

  async function deletePoll() {
    if (!pollId || !window.confirm('Delete this poll permanently?')) return;
    try {
      await request(`/api/polls/${pollId}`, { method: 'DELETE' });
      navigate('/');
      await loadPolls();
      setNotice('Poll deleted');
    } catch (e) { setError(e.message); }
  }

  function startEdit() {
    setEditQuestion(poll.question);
    setEditOptions(poll.options.map(o => o.text));
    setEditing(true);
  }

  async function saveEdit() {
    try {
      const updated = await request(`/api/polls/${pollId}`, {
        method: 'PUT',
        body: JSON.stringify({ question: editQuestion, options: editOptions })
      });
      setPoll(updated);
      setEditing(false);
      setNotice('Poll updated');
    } catch (e) { setError(e.message); }
  }

  const total = poll?.totalVotes || 0;

  return (
    <div className="app">
      <header className="siteHeader">
        <button className="brand" onClick={() => navigate('/')}>
          <span className="brandIcon">
            <Vote size={21} />
          </span>
          <span>Pulse<span className="brandAccent">Vote</span></span>
        </button>

        <div className="nav">
          {user ? (
            <>
              <span className="welcome">
                Hi, {user.name}
              </span>
              <button className="ghost" onClick={logout}>
                <LogOut size={16} />
                Sign out
              </button>
            </>
          ) : (
            <button
              className="ghost"
              onClick={() => {
                navigate('/');
                setAuthMode('login');
                setTimeout(() => {
                  document.getElementById('auth')
                    ?.scrollIntoView({ behavior: 'smooth' });
                }, 50);
              }}
            >
              <LogIn size={16} />
              Sign in
            </button>
          )}
        </div>
      </header>

      <main>
        {error && (
          <div className="alert">
            <span>{error}</span>
            <button onClick={() => setError('')}>×</button>
          </div>
        )}

        {notice && (
          <div className="notice">
            <span>{notice}</span>
            <button onClick={() => setNotice('')}>×</button>
          </div>
        )}

        {!pollId && page !== '/create' && (
          <>
            <section className="hero">
              <div className="eyebrow">
                <Radio size={15} />
                REAL-TIME AUDIENCE POLLING
              </div>

              <h1>
                Every voice.
                <br />
                <span>In the moment.</span>
              </h1>

              <p>
                Create a poll, share it with your audience,
                and watch opinions come alive in real time.
              </p>

              <div className="heroActions">
                <button
                  className="primary"
                  onClick={() =>
                    user
                      ? navigate('/create')
                      : (
                        setAuthMode('signup'),
                        document.getElementById('auth')
                          ?.scrollIntoView({ behavior: 'smooth' })
                      )
                  }
                >
                  <Plus size={18} />
                  Create a poll
                  <ArrowUpRight size={16} />
                </button>

                <span className="liveHint">
                  <i />
                  Live results. No refresh.
                </span>
              </div>

              <div className="heroStats">
                <div>
                  <strong>{polls.length}</strong>
                  <span>Community polls</span>
                </div>
                <div>
                  <strong>
                    {polls.reduce(
                      (sum, p) => sum + (p.totalVotes || 0),
                      0
                    )}
                  </strong>
                  <span>Votes recorded</span>
                </div>
                <div>
                  <strong>Live</strong>
                  <span>Real-time results</span>
                </div>
              </div>
            </section>

            {!user && (
              <section className="auth card" id="auth">
                <div className="cardHead">
                  <span className="tag">
                    <Sparkles size={13} />
                    GET STARTED
                  </span>
                  <h2>
                    {authMode === 'signup'
                      ? 'Join the conversation'
                      : 'Welcome back'}
                  </h2>
                  <p>
                    {authMode === 'signup'
                      ? 'Create an account to publish your own polls.'
                      : 'Sign in to create polls and cast your vote.'}
                  </p>
                </div>

                <form onSubmit={submitAuth} className="form">
                  {authMode === 'signup' && (
                    <input
                      placeholder="Your name"
                      value={auth.name}
                      onChange={e =>
                        setAuth({ ...auth, name: e.target.value })
                      }
                      required
                    />
                  )}

                  <input
                    type="email"
                    placeholder="Email address"
                    value={auth.email}
                    onChange={e =>
                      setAuth({ ...auth, email: e.target.value })
                    }
                    required
                  />

                  <input
                    type="password"
                    placeholder="Password (8+ characters)"
                    minLength="8"
                    value={auth.password}
                    onChange={e =>
                      setAuth({ ...auth, password: e.target.value })
                    }
                    required
                  />

                  <button className="primary full">
                    {authMode === 'signup'
                      ? 'Create account'
                      : 'Sign in'}
                  </button>
                </form>

                <p className="switch">
                  {authMode === 'signup'
                    ? 'Already have an account?'
                    : 'New to PulseVote?'}
                  {' '}
                  <button
                    onClick={() =>
                      setAuthMode(
                        authMode === 'signup' ? 'login' : 'signup'
                      )
                    }
                  >
                    {authMode === 'signup'
                      ? 'Sign in'
                      : 'Create account'}
                  </button>
                </p>
              </section>
            )}

            <section className="sectionTitle">
              <div>
                <span className="tag">THE COMMUNITY</span>
                <h2>Explore polls</h2>
                <p>Discover what everyone is talking about.</p>
              </div>
            </section>

            <section className="pollGrid">
              {polls.map(p => (
                <button
                  className="pollCard"
                  key={p.id}
                  onClick={() => navigate('/poll/' + p.id)}
                >
                  <div className="pollCardTop">
                    <span className="tag">PUBLIC POLL</span>
                    <ArrowUpRight size={18} />
                  </div>

                  <h3>{p.question}</h3>

                  <div className="pollMeta">
                    <span>
                      <Users size={14} />
                      {p.totalVotes || 0} votes
                    </span>
                    <span>{p.options.length} options</span>
                  </div>

                  <div className="pollCardFooter">
                    <span>View poll</span>
                    <span className="cardArrow">↗</span>
                  </div>
                </button>
              ))}
            </section>

            {polls.length === 0 && (
              <div className="emptyState">
                <div className="emptyIcon">
                  <BarChart3 size={25} />
                </div>
                <h3>No polls yet</h3>
                <p>Be the first to start a conversation.</p>
              </div>
            )}
          </>
        )}

        {page === '/create' && (
          <section className="createPage">
            <button className="backLink" onClick={() => navigate('/')}>
              <ChevronLeft size={17} />
              Back to polls
            </button>

            <section className="card createCard">
              <div className="cardHead">
                <span className="tag">
                  <Sparkles size={13} />
                  NEW POLL
                </span>
                <h2>Ask your audience</h2>
                <p>
                  A great question starts a great conversation.
                </p>
              </div>

              <form className="form" onSubmit={createPoll}>
                <label>Question</label>
                <textarea
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  maxLength="200"
                  placeholder="What would you like to ask?"
                  required
                />

                <div className="optionsLabel">
                  <label>Answer options</label>
                  <span>{options.length}/8</span>
                </div>

                {options.map((o, i) => (
                  <div className="optionInput" key={i}>
                    <input
                      value={o}
                      maxLength="100"
                      onChange={e =>
                        setOptions(
                          options.map((x, j) =>
                            j === i ? e.target.value : x
                          )
                        )
                      }
                      placeholder={`Option ${i + 1}`}
                      required
                    />

                    <button
                      type="button"
                      className="remove"
                      disabled={options.length <= 2}
                      onClick={() =>
                        setOptions(options.filter((_, j) => j !== i))
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}

                {options.length < 8 && (
                  <button
                    type="button"
                    className="addOption"
                    onClick={() => setOptions([...options, ''])}
                  >
                    <Plus size={15} />
                    Add option
                  </button>
                )}

                <label>Close poll (optional)</label>
                <input
                  type="datetime-local"
                  value={expires}
                  onChange={e => setExpires(e.target.value)}
                />
                <label className="quizToggle">
                  <input type="checkbox" checked={quiz} onChange={e => { setQuiz(e.target.checked); setCorrectOptionId(''); }} />
                  Make this an interactive quiz
                </label>
                {quiz && (
                  <>
                    <label>Correct answer</label>
                    <select value={correctOptionId} onChange={e => setCorrectOptionId(e.target.value)} required>
                      <option value="">Choose correct option</option>
                      {options.map((o, i) => o.trim() && <option key={i} value={o}>{o}</option>)}
                    </select>
                    <p className="smallNote">The answer is revealed after a participant submits their response.</p>
                  </>
                )}

                <button
                  className="primary full"
                  disabled={!user || busy}
                >
                  {busy ? 'Publishing…' : 'Publish poll'}
                  {!busy && <ArrowUpRight size={17} />}
                </button>
              </form>
            </section>
          </section>
        )}

        {pollId && poll && (
          <section className="pollView">
            <div className="pollTop">
              <button className="backLink" onClick={() => navigate('/')}>
                <ChevronLeft size={17} />
                All polls
              </button>

              <div className="pollActions">
                <button className="secondary" onClick={copyLink}><Copy size={16} /> Share poll</button>
                <button className="secondary" onClick={() => setQrOpen(true)}>QR code</button>
                <button className="secondary" onClick={() => setPresenter(true)}>Presenter mode</button>
                {user?.id === poll.creatorId && poll.totalVotes === 0 && !isClosed(poll) && <button className="secondary" onClick={startEdit}>Edit poll</button>}
                {user?.id === poll.creatorId && <button className="dangerButton" onClick={deletePoll}>Delete poll</button>}
              </div>
            </div>

            <section className="card pollMain">
              {editing && <div className="editPanel"><h2>Edit poll</h2><label>Question</label><input value={editQuestion} onChange={e=>setEditQuestion(e.target.value)} maxLength={200}/>{editOptions.map((o,i)=><input key={i} value={o} onChange={e=>setEditOptions(editOptions.map((x,j)=>j===i?e.target.value:x))} maxLength={100}/>)}<div className="pollActions"><button className="primary" onClick={saveEdit}>Save changes</button><button className="secondary" onClick={()=>setEditing(false)}>Cancel</button></div></div>}
              <div className="pollMetaTop">
                <span className="tag">LIVE POLL</span>
                <span className="liveBadge">
                  <i />
                  LIVE RESULTS
                </span>
              </div>

              <h1>{poll.question}</h1>

              <p className="pollBy">
                Created by {poll.creatorName}
              </p>

              {poll.expiresAt && (
                <p className="expiry">
                  <Clock3 size={14} />
                  Closes {formatDate(poll.expiresAt)}
                </p>
              )}

              <div className="dashboardStats">
                <div className="dashboardStat">
                  <span className="statIcon purple">
                    <Users size={18} />
                  </span>
                  <div>
                    <strong>{total}</strong>
                    <span>Total votes</span>
                  </div>
                </div>

                <div className="dashboardStat">
                  <span className="statIcon green">
                    <BarChart3 size={18} />
                  </span>
                  <div>
                    <strong>{poll.options.length}</strong>
                    <span>Options</span>
                  </div>
                </div>

                <div className="dashboardStat">
                  <span className="statIcon blue">
                    <Radio size={18} />
                  </span>
                  <div>
                    <strong>Live</strong>
                    <span>Updates</span>
                  </div>
                </div>
              </div>

              <div className="dashboardSection">
                <div className="dashboardHeading">
                  <div>
                    <h2>Vote distribution</h2>
                    <p>See how the audience is voting.</p>
                  </div>
                  <span className="livePill">
                    <i />
                    Live
                  </span>
                </div>

                <div className="distributionVisual">
                  <div
                    className="donutChart"
                    role="img"
                    aria-label={`Vote distribution: ${poll.options.map(o => `${o.text}, ${o.votes} votes`).join('; ')}`}
                    style={{
                      background: total
                        ? `conic-gradient(${poll.options.map((o, i) => {
                            const start = poll.options
                              .slice(0, i)
                              .reduce((sum, item) => sum + item.votes, 0);
                            const end = start + o.votes;
                            const color = ['#6c5ce7', '#12b886', '#339af0', '#f08c35', '#e64980'][i % 5];
                            return `${color} ${(start / total) * 100}% ${(end / total) * 100}%`;
                          }).join(', ')})`
                        : 'conic-gradient(#e9eaf3 0% 100%)'
                    }}
                  >
                    <div className="donutCenter">
                      <strong>{total}</strong>
                      <span>{total === 1 ? 'vote' : 'votes'}</span>
                    </div>
                  </div>
                  <div className="distributionLegend">
                    {poll.options.map((o, i) => {
                      const pct = total ? Math.round((o.votes / total) * 100) : 0;
                      return (
                        <div className="legendItem" key={o.id}>
                          <span className={`legendSwatch chartColor${i % 5}`} />
                          <span className="legendText">{o.text}</span>
                          <strong>{pct}%</strong>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="chart">
                  {poll.options.map((o, i) => {
                    const pct = total
                      ? Math.round((o.votes / total) * 100)
                      : 0;

                    return (
                      <div className="chartRow" key={o.id}>
                        <div className="chartLabel">
                          <span className="chartDot" />
                          <span className="chartOption">{o.text}</span>
                          <strong>{pct}%</strong>
                        </div>

                        <div className="chartTrack">
                          <div
                            className={`chartBar chartColor${i % 5}`}
                            style={{ width: pct + '%' }}
                          />
                        </div>

                        <div className="chartDetails">
                          <span>{o.votes} votes</span>
                          <span>{pct}% of total</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {analytics && (
                <div className="dashboardSection analyticsPanel">
                  <div className="dashboardHeading"><div><h2>Live analytics</h2><p>Vote trends and audience participation.</p></div><span className="livePill"><i /> Live</span></div>
                  <div className="analyticsStats">
                    <div><strong>{analytics.participationRate.toFixed(1)}%</strong><span>Participation rate*</span></div>
                    <div><strong>{analytics.leadingOption || '—'}</strong><span>Leading option</span></div>
                  </div>
                  <div className="trendBars" aria-label="Hourly vote trend">
                    {analytics.voteTrend.map(point => <div className="trendColumn" key={point.time} title={`${new Date(point.time).toLocaleString()}: ${point.votes} votes`}><span style={{height:`${Math.max(6, point.votes / Math.max(...analytics.voteTrend.map(x=>x.votes),1)*100)}%`}}/><small>{new Date(point.time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</small></div>)}
                    {analytics.voteTrend.length===0 && <p className="smallNote">Vote activity will appear here.</p>}
                  </div>
                  <p className="smallNote">* Estimated against registered accounts.</p>
                </div>
              )}

              {poll.quiz && (
                <div className="dashboardSection quizPanel">
                  <h2>Interactive quiz</h2>
                  {quizResult ? <p>{quizResult.correct ? 'Correct answer! +1 participation point.' : 'Not quite. The correct answer is highlighted below.'}</p> : <p>Submit your response to reveal the correct answer.</p>}
                  {quizResult && <p><strong>Score: {quizResult.score}/1</strong></p>}
                </div>
              )}

              <div className="dashboardSection">
                <div className="dashboardHeading">
                  <div>
                    <h2>Cast your vote</h2>
                    <p>Select an option to participate.</p>
                  </div>
                </div>

                <div className="voteOptions">
                  {poll.options.map(o => {
                    const pct = total
                      ? Math.round((o.votes / total) * 100)
                      : 0;

                    return (
                      <button
                        key={o.id}
                        className={`voteOption ${selected === o.id ? 'selected' : ''} ${quizResult?.correctOptionId === o.id ? 'correctAnswer' : ''}`}
                        onClick={() => setSelected(o.id)}
                      >
                        <span className="voteOptionText">
                          {o.text}
                          {selected === o.id && <Check size={16} />}
                        </span>

                        <div className="barTrack">
                          <div
                            className="barFill"
                            style={{ width: pct + '%' }}
                          />
                        </div>

                        <div className="voteStats">
                          <span>{o.votes} votes</span>
                          <strong>{pct}%</strong>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <button
                  className="primary full voteButton"
                  disabled={!selected || busy || !user}
                  onClick={vote}
                >
                  {busy
                    ? 'Submitting…'
                    : user
                      ? 'Submit vote'
                      : 'Sign in to vote'}
                  {!busy && <ArrowUpRight size={17} />}
                </button>

                {!user && (
                  <p className="smallNote">
                    Sign in to cast your vote. Results are live for everyone.
                  </p>
                )}
              </div>

              <div className="liveFooter">
                <span><i /> Live updates enabled</span>
                <span>{total} total votes</span>
              </div>
            </section>
            {qrOpen && <div className="modalBackdrop" onClick={()=>setQrOpen(false)}><div className="qrModal" onClick={e=>e.stopPropagation()}><button className="modalClose" onClick={()=>setQrOpen(false)}>×</button><h2>Scan to join this poll</h2><img alt="QR code for poll" src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(location.origin + '/poll/' + pollId)}`}/><p>Scan with your phone camera to open the poll.</p><button className="secondary" onClick={copyLink}>Copy poll link</button></div></div>}
            {presenter && <div className="presenterOverlay"><button className="presenterExit" onClick={()=>setPresenter(false)}>Exit presenter mode ✕</button><span className="tag">LIVE POLL</span><h1>{poll.question}</h1><div className="presenterResults">{poll.options.map(o=><div key={o.id}><strong>{o.text}</strong><span>{total?Math.round(o.votes/total*100):0}% · {o.votes} votes</span><div className="barTrack"><div className="barFill" style={{width:(total?o.votes/total*100:0)+'%'}}/></div></div>)}</div></div>}
          </section>
        )}

        {pollId && !poll && (
          <div className="loading">Loading poll…</div>
        )}
      </main>

      <footer>
        <span>PulseVote</span>
        <span>Built for voices in real time.</span>
      </footer>
    </div>
  );
}