import VoteLinkClient from './VoteLinkClient';

// Thin server-component wrapper: this Next.js version resolves route params
// as a Promise (see the sibling API route's ctx.params), so the actual page
// logic (fetch, deep-link attempt, state) lives in a client component that
// takes the resolved token as a plain string prop.
export default async function VoteLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <VoteLinkClient token={token} />;
}
