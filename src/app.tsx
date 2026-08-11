import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSession } from './api/queries';
import { AppShell } from './components/layout';
import { ErrorNotice, LoadingBlock } from './components/primitives';
import { DraftProvider } from './state/draft-store';
import { useDraftStore } from './state/draft-context';
import { launchElement, useRouter, type Route } from './state/router';
import { HomeScreen } from './screens/home';
import { AssetDetailScreen } from './screens/asset-detail';
import { QuestionnaireScreen } from './screens/questionnaire';
import { ReviewScreen } from './screens/review';
import { OutcomeScreen } from './screens/outcome';
import { MyRequestsScreen } from './screens/my-requests';
import { MiError } from './api/http';

/**
 * A single client for the whole App.
 *
 * `retry` is off by default. MI's throttle is 100 requests a minute across
 * `/p/` and `/data/page/*` together, so an automatic retry storm is the one
 * thing most likely to turn a transient failure into a sustained one — and a
 * 403 or a 405 will never succeed on a second attempt anyway.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof MiError) {
          return false;
        }

        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DraftProvider>
        <Router />
      </DraftProvider>
    </QueryClientProvider>
  );
}

function Router() {
  const { route, navigate } = useRouter();
  const session = useSession();
  const draft = useDraftStore();

  // Honour `?element=<id>` on first load. This is the App's entry contract:
  // the requester picked the asset in Metric Insights' own catalog, and the
  // Access Denied Message carried its id across. Everything else about the
  // asset is read from MI rather than trusted from the URL.
  useEffect(() => {
    if (window.location.hash && window.location.hash !== '#/') {
      return;
    }

    const launch = launchElement();

    if (launch) {
      navigate(
        { name: 'asset', elementId: launch.elementId, segmentValueId: launch.segmentValueId },
        { replace: true },
      );
    }
  }, [navigate]);

  // The session is checked before the draft. The draft is keyed on the user
  // id, so a failed session leaves it permanently un-hydrated — checking
  // readiness first would hold the App on the loading skeleton forever instead
  // of showing why the session could not be read.
  if (session.error) {
    return (
      <div className="ar-app">
        <ErrorNotice error={session.error} context="Could not read your Metric Insights session" />
      </div>
    );
  }

  if (session.isLoading || !draft.ready) {
    return (
      <div className="ar-app">
        <LoadingBlock label="Loading" rows={4} />
      </div>
    );
  }

  return (
    <AppShell route={route} navigate={navigate}>
      <Screen route={route} navigate={navigate} />
    </AppShell>
  );
}

function Screen({ route, navigate }: { route: Route; navigate: (route: Route) => void }) {
  switch (route.name) {
    case 'asset':
      return (
        <AssetDetailScreen elementId={route.elementId} segmentValueId={route.segmentValueId} navigate={navigate} />
      );
    case 'questionnaire':
      return (
        <QuestionnaireScreen elementId={route.elementId} segmentValueId={route.segmentValueId} navigate={navigate} />
      );
    case 'review':
      return <ReviewScreen elementId={route.elementId} segmentValueId={route.segmentValueId} navigate={navigate} />;
    case 'outcome':
      return <OutcomeScreen requestId={route.requestId} navigate={navigate} />;
    case 'requests':
      return <MyRequestsScreen />;
    case 'home':
    default:
      return <HomeScreen navigate={navigate} />;
  }
}
