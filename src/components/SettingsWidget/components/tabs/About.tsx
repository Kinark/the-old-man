import styled from 'styled-components';
import { getLuminance } from 'polished';

import useUserStore from '~/instances/userStore';

import Title from '~/components/Title';
import Toggle from '~/components/Toggle';

const Appearence = () => {
  const { showNodeIds, showConditionsConnections, duplicateEdgesWhenAltDragging } = useUserStore(
    (s) => s.preferences
  );
  const setPreferences = useUserStore((s) => s.setPreferences);

  return (
    <div>
      <Title style={{ marginTop: 0 }}>About</Title>
      <div>
        <div>
          Created with ❤️ by <Link href="mailto:igormarcossi@hey.com">Igor Marcossi</Link>.
        </div>
        <div>
          App v{process.env.NODE_ENV === 'production' ? __APP_VERSION__ : '-Development' }.
        </div>
      </div>
    </div>
  );
};

export default Appearence;

const Link = styled.a`
  color: inherit;
`;