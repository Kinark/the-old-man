import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import styled, { css, useTheme } from 'styled-components';
import memoizee from 'memoizee';
import { nanoid } from 'nanoid';
import cloneDeep from 'lodash/cloneDeep';
import Draggable, { DraggableEvent, DraggableData } from 'react-draggable';
import {
  FiMessageSquare,
  FiList,
  FiPlus,
  FiBox,
  FiUser,
  FiHelpCircle,
  FiPlay,
  FiCornerLeftUp,
  FiCornerLeftDown,
  FiUpload,
  FiHeart,
} from 'react-icons/fi';
import ReactFlow, {
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  Node,
  Edge,
  useKeyPress,
  MiniMap,
  updateEdge,
  Background,
  useViewport,
  ReactFlowInstance,
  useUpdateNodeInternals,
  NodeChange,
  EdgeChange,
  Connection,
  OnSelectionChangeParams,
} from '@kinark/react-flow-renderer';
import { getFirestore, getDoc, setDoc, doc } from 'firebase/firestore';
import { lighten, getLuminance, darken } from 'polished';

import useUserStore, { ThemeTypes } from '~/instances/userStore';

import {
  ID,
  ChatNode,
  Character,
  Chat,
  Workspace,
  DataStructure,
  ChatNodeTypes,
} from '~/types/data';

import lightButton from '~/assets/lightButton.png';
import darkButton from '~/assets/darkButton.png';
import autoButton from '~/assets/autoButton.png';

import Title from '~/components/Title';
import discordIcon from '~/components/discord.svg';
import Input from '~/components/Input';
import Textarea from '~/components/Textarea';
import LoginWidget from '~/components/LoginWidget';
import SelectableList from '~/components/SelectableList';
import SettingsWidget from '~/components/SettingsWidget';
import NormalEdge from '~/components/NormalEdge';
import ConditionEdge from '~/components/ConditionEdge';
import FixedButton from '~/components/FixedButton';
import ChatNodeCard from '~/components/ChatNodeCard';
import ConditionNodeCard from '~/components/ConditionNodeCard';
import FScreenListing from '~/components/FScreenListing';
import {
  CHAT_NODE_CONDITION_TYPE,
  CHAT_NODE_ANSWER_TYPE,
  CHAT_NODE_TEXT_TYPE,
  ID_SIZE,
  COLORS,
} from '~/constants/variables';
import downloadFile from '~/utils/downloadFile';
import { Optional } from '~/types/utils';
import {
  initialCharacterData,
  initialChatNodeData,
  initialChatData,
  initialWorkspaceData,
} from '~/constants/initialData';
import { initFirebase } from '~/instances/firebase';
import colors from '~/constants/colors';
import useTimeTravel from '~/hooks/useTimeTravel';
import useDebounceFunc from '~/hooks/useDebounceFunc';

initFirebase();

const db = getFirestore();

type WorkspacesNames = Optional<Workspace, 'characters' | 'chats'>;
type ChatNames = Optional<Chat, 'nodes' | 'edges'>;

const nodeTypes = {
  [CHAT_NODE_TEXT_TYPE]: ChatNodeCard,
  [CHAT_NODE_CONDITION_TYPE]: ConditionNodeCard,
  [CHAT_NODE_ANSWER_TYPE]: ChatNodeCard,
};
const edgeTypes = { button: NormalEdge, normal: NormalEdge, condition: ConditionEdge };
const multiselectKeys = ['Meta', 'Control'];

const _loadOrSave = (data?: DataStructure): DataStructure => {
  if (typeof window === 'undefined') return [];
  if (data) {
    localStorage.setItem('datav2', JSON.stringify(data));
    return data;
  }
  const storedData = localStorage.getItem('datav2');
  return !storedData || !JSON.parse(storedData).length ? [] : JSON.parse(storedData);
};

const Story = () => {
  const theme = useTheme();
  const loggedUserId = useUserStore((s) => s.uid);

  const loadOrSave = (newData?: DataStructure) => {
    if (newData) {
      clearTimeout(debounceCloudSave.current);
      debounceCloudSave.current = setTimeout(() => {
        _loadOrSave(newData);
        if (loggedUserId) {
          setDoc(doc(db, 'usersData', loggedUserId), { data: data.current });
        }
      }, 300);
      return newData;
    }
    return _loadOrSave();
  };

  const altPressed = useKeyPress('AltLeft');
  const spacePressed = useKeyPress('Space');
  const updateNodeInternals = useUpdateNodeInternals();

  const loadedData = useRef(loadOrSave());
  const {
    present: data,
    undo,
    redo,
    snapshot,
    reset,
  } = useTimeTravel<DataStructure>(loadedData.current!);
  const reactFlowWrapper = useRef(null);
  const lastCopied = useRef<null | ChatNode[]>(null);
  const playModeAnswersIds = useRef<ID[]>([]);
  const newItemRef = useRef(null);
  const debounceCloudSave = useRef<any>(null);
  const debounceConditionBundle = useRef<any>(null);
  const prevCounditionBundle = useRef<any>(null);

  const [workspacesNames, _setWorkspacesNames] = useState<WorkspacesNames[]>(
    data.current.map(({ id, name }) => ({ id, name }))
  );
  const [characters, setCharacters] = useState<Character[]>(data.current[0]?.characters || []);
  const [chatsNames, _setChatsNames] = useState<ChatNames[]>(
    data.current[0]?.chats.map(({ id, name }) => ({ id, name })) || []
  );
  const [nodes, setNodes] = useState<ChatNode[]>(data.current[0]?.chats[0]?.nodes || []);
  const [edges, setEdges] = useState<Edge[]>(data.current[0]?.chats[0]?.edges || []);
  const { zoom } = useViewport();

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<ID | null>(
    !!loadedData.current && !!loadedData.current[0] ? loadedData.current[0].id : null
  );
  const [selectedChatId, setSelectedChatId] = useState<ID | null>(
    !!loadedData.current && !!loadedData.current[0] && !!loadedData.current[0].chats[0]
      ? loadedData.current[0].chats[0].id
      : null
  );
  const [isAddingNewNode, setIsAddingNewNode] = useState<boolean | 'ending'>(false);
  const [spotlight, setSpotlight] = useState<ID | null>(null);
  const [scheduleSnapshop, setScheduleSnapshot] = useState(false);

  const [whatToPlay, setWhatToPlay] = useState<{ toShow: ChatNode; buttons: ChatNode[] } | null>(
    null
  );

  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);

  const setChatsNames = (newChats: (old: ChatNames[]) => ChatNames[]) =>
    _setChatsNames((old) => newChats(old).map(({ id, name }) => ({ id, name })));

  const setWorkspacesNames = (newWorkspaces: (old: WorkspacesNames[]) => WorkspacesNames[]) =>
    _setWorkspacesNames((old) => newWorkspaces(old).map(({ id, name }) => ({ id, name })));

  const getSelectedWorkspace = (obj: DataStructure): Workspace | null =>
    obj.find((w) => w.id === selectedWorkspaceId) || null;

  const getSelectedChat = (obj: DataStructure): Chat | null =>
    getSelectedWorkspace(obj)?.chats.find((c) => c.id === selectedChatId) || null;

  const selectedWorkspace = getSelectedWorkspace(data.current);
  const selectedChat = getSelectedChat(data.current);
  const selectedNodes = useMemo(() => nodes && nodes.filter((x) => x.selected), [nodes]);

  const getRelatedEdges = useCallback(
    memoizee((nodeId: ID) => edges.filter((e) => e.source === nodeId || e.target === nodeId)),
    [nodes, edges]
  );

  const callUndo = () => {
    undo();
    updateMirrors();
    loadOrSave(data.current);
  };

  const callRedo = () => {
    redo();
    updateMirrors();
    loadOrSave(data.current);
  };

  const bindUndoRedo = useCallback((event: KeyboardEvent) => {
    if (
      document.activeElement?.tagName === 'INPUT' ||
      document.activeElement?.tagName === 'TEXTAREA'
    )
      return;
    if ((event.metaKey || event.ctrlKey) && event.key === 'z') {
      if (event.shiftKey) {
        callRedo();
        return;
      }
      callUndo();
    }
  }, []);

  useEffect(() => {
    const imagesPreload = [lightButton, darkButton, autoButton];
    imagesPreload.forEach((image) => {
      const newImage = new Image();
      newImage.src = image;
      // @ts-ignore: Unreachable code error
      window[image] = newImage;
    });
    document.addEventListener('keydown', bindUndoRedo);
    return () => {
      document.removeEventListener('keydown', bindUndoRedo);
    };
  }, []);

  const conditionsBundle = useMemo<({ nodes: ID[] } & ChatNode)[]>(() => {
    if (prevCounditionBundle.current && debounceConditionBundle.current) {
      clearTimeout(debounceConditionBundle.current);
      debounceConditionBundle.current = setTimeout(() => {
        debounceConditionBundle.current = null;
      }, 300);
      return prevCounditionBundle.current;
    }
    return edges
      .filter((edg) => edg.sourceHandle === CHAT_NODE_CONDITION_TYPE)
      .reduce((prev, curr) => {
        const newArr = [...prev];
        const targetNode = nodes.find((nd) => nd.id === curr.target);
        const foundCondition = nodes.find((nd) => nd.id === curr.source);
        if (!targetNode || !foundCondition) return prev;
        const foundGroup = newArr.find((gr) => gr.id === curr.source);

        if (foundGroup) {
          foundGroup.nodes.push(curr.target);
        } else {
          newArr.push({
            ...foundCondition,
            nodes: [targetNode.id],
          });
        }
        return newArr;
      }, [] as ({ nodes: ID[] } & ChatNode)[]);
  }, [nodes, edges]);

  useEffect(() => {
    if (!loggedUserId) return;
    const fetchData = async () => {
      const retrievedDoc = await getDoc(doc(db, 'usersData', loggedUserId));
      if (!retrievedDoc.data() || !retrievedDoc.data()!.data) return;
      const mergedDatas = [
        ...data.current,
        ...retrievedDoc
          .data()!
          .data.filter((x: Workspace) => !data.current.find((el) => x.id === el.id)),
      ];
      data.current = mergedDatas;
      reset();
      updateMirrors();
      loadOrSave(data.current);
    };
    fetchData();
  }, [loggedUserId]);

  const updateNodesInData = () => {
    if (!selectedChatId || !getSelectedChat(data.current)) return;
    const dataCopy = cloneDeep(data.current);
    getSelectedChat(dataCopy)!.nodes = nodes;
    data.current = dataCopy;
    loadOrSave(data.current);
  };

  const updateEdgesInData = () => {
    if (!selectedChatId || !getSelectedChat(data.current)) return;
    const dataCopy = cloneDeep(data.current);
    getSelectedChat(dataCopy)!.edges = edges;
    data.current = dataCopy;
    loadOrSave(data.current);
  };

  const updateCharactersInData = () => {
    if (!selectedChatId || !getSelectedWorkspace(data.current)) return;
    const dataCopy = cloneDeep(data.current);
    getSelectedWorkspace(dataCopy)!.characters = characters;
    data.current = dataCopy;
    loadOrSave(data.current);
  };

  const updateChatsNamesInData = () => {
    if (!selectedWorkspaceId) return;
    const selectedWorkspaceChats = getSelectedWorkspace(data.current)?.chats;
    if (!selectedWorkspaceChats) return;
    const dataCopy = cloneDeep(data.current);
    getSelectedWorkspace(dataCopy)!.chats = chatsNames.map((c) =>
      selectedWorkspaceChats.find(({ id }) => id === c.id)
        ? { ...selectedWorkspaceChats.find(({ id }) => id === c.id), ...c }
        : { ...initialChatData(), ...c }
    ) as Chat[];
    data.current = dataCopy;
    loadOrSave(data.current);
  };

  const updateWorkspacesNamesInData = () => {
    data.current = workspacesNames.map((w) =>
      data.current.find(({ id }) => id === w.id)
        ? {
            ...data.current.find(({ id }) => id === w.id),
            ...w,
          }
        : { ...initialWorkspaceData(), ...w }
    ) as DataStructure;
    loadOrSave(data.current);
  };

  useEffect(updateNodesInData, [nodes]);
  useEffect(updateEdgesInData, [edges]);
  useEffect(updateCharactersInData, [characters]);
  useEffect(updateChatsNamesInData, [chatsNames]);
  useEffect(updateWorkspacesNamesInData, [workspacesNames]);

  const updateMirrors = () => {
    setWorkspacesNames(() => data.current || []);
    setCharacters(() => getSelectedWorkspace(data.current)?.characters || []);
    setChatsNames(() => getSelectedWorkspace(data.current)?.chats || []);
    setNodes(selectedChatId ? getSelectedChat(data.current)?.nodes || [] : []);
    setEdges(selectedChatId ? getSelectedChat(data.current)?.edges || [] : []);
  };

  useEffect(() => {
    updateMirrors();
  }, [selectedChatId, selectedWorkspaceId]);

  const saveInputChange = useDebounceFunc(() => {
    snapshot();
  }, 250);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { value, name } = e.target;
    saveInputChange();
    setNodes(
      nodes.map((item) =>
        item.selected
          ? {
              ...item,
              data: {
                ...item.data,
                [name]: value,
              },
            }
          : item
      )
    );
  };

  const changeTypes = (targetNds: ChatNode[], type: ChatNodeTypes) => {
    if (!targetNds.length) return;
    const targetIds = targetNds.map((nd) => nd.id);
    snapshot();
    setNodes(
      nodes.map((item) =>
        targetIds.includes(item.id)
          ? {
              ...item,
              type,
            }
          : item
      )
    );
    // if (type === CHAT_NODE_CONDITION_TYPE)
    setEdges((old) =>
      old.filter((edg) => !targetIds.includes(edg.source) && !targetIds.includes(edg.target))
    );
    targetIds.forEach((id) => updateNodeInternals(id));
  };

  const deleteChat = (targetId: ID) => {
    if (!selectedWorkspace || !targetId) return;
    if (targetId === selectedChatId) setSelectedChatId(null);
    snapshot();
    _setChatsNames((old) => old.filter(({ id }) => id !== targetId));
  };

  const deleteWorkspace = (targetId: ID) => {
    if (!targetId) return;
    snapshot();
    if (targetId === selectedWorkspaceId) {
      setSelectedChatId(null);
      setSelectedWorkspaceId(null);
    }
    _setWorkspacesNames((old) => old.filter(({ id }) => id !== targetId));
  };

  const deleteChar = (targetId: ID) => {
    if (!selectedWorkspace) return;
    snapshot();
    setCharacters((old) => old.filter((char) => char.id !== targetId));
    setNodes((old) =>
      old.map((node) => ({
        ...node,
        data: {
          ...node.data,
          character: node.data.character === targetId ? null : node.data.character,
        },
      }))
    );
  };

  const addChar = () => {
    snapshot();
    setCharacters((old) => [...old, initialCharacterData()]);
  };

  const addChat = () => {
    if (!selectedWorkspace) return;
    snapshot();
    const newChat = initialChatData();
    setChatsNames((old) => [...old, newChat]);
    setSelectedChatId(newChat.id);
  };

  const addWorkspace = () => {
    snapshot();
    const newWorkspace = initialWorkspaceData();
    setWorkspacesNames((old) => [...old, newWorkspace]);
    setSelectedWorkspaceId(newWorkspace.id);
    setScheduleSnapshot(true);
  };

  const changeWorkspaceName = (e: React.ChangeEvent<HTMLInputElement>) => {
    saveInputChange();
    _setWorkspacesNames((old) =>
      old.map((w) => (w.id === e.target.name ? { ...w, name: e.target.value } : w))
    );
  };

  const changeChatName = (e: React.ChangeEvent<HTMLInputElement>) => {
    saveInputChange();
    _setChatsNames((old) =>
      old.map((c) => (c.id === e.target.name ? { ...c, name: e.target.value } : c))
    );
  };

  const changeCharName = (e: React.ChangeEvent<HTMLInputElement>) => {
    saveInputChange();
    setCharacters((old) =>
      old.map(({ id, name }) =>
        id === e.target.name ? { id, name: e.target.value } : { id, name }
      )
    );
  };

  const setCharacter = (targetId: ID, characterId: ID) => {
    snapshot();
    const previousCharacter = nodes.find((node) => node.id === targetId)?.data.character;
    setNodes((old) =>
      old.map((node) => {
        if (node.id === targetId) {
          return {
            ...node,
            data: {
              ...node.data,
              character: previousCharacter === characterId ? null : characterId,
            },
          };
        }
        return node;
      })
    );
  };

  const transformData = () => {
    const dataCopy = cloneDeep(data.current);
    return dataCopy.map((ws) => ({
      ...ws,
      chats: ws.chats.map((ch) => ({
        id: ch.id,
        name: ch.name,
        nodes: ch.nodes.map((nd) => ({
          id: nd.id,
          type: nd.type,
          message: nd.data.message,
          character: nd.data.character,
          tonyData: {
            position: nd.position,
          },
          goesTo:
            nd.type === CHAT_NODE_CONDITION_TYPE
              ? ch.edges
                  .filter((e) => e.source === nd.id)
                  .reduce(
                    (prev: { conditions: string[]; yes: string[]; no: string[] }, curr) => {
                      const newConditions = curr.sourceHandle === 'condition' ? [curr.target] : [];
                      const newYes = curr.sourceHandle === 'yes' ? [curr.target] : [];
                      const newNo = curr.sourceHandle === 'no' ? [curr.target] : [];
                      return {
                        conditions: [...prev.conditions, ...newConditions],
                        yes: [...prev.yes, ...newYes],
                        no: [...prev.no, ...newNo],
                      };
                    },
                    { conditions: [], yes: [], no: [] }
                  )
              : ch.edges.filter((e) => e.source === nd.id).map((e) => e.target),
        })),
      })),
    }));
  };

  const newEdge = ({
    source,
    sourceHandle,
    target,
    targetHandle,
  }: {
    source: ID;
    sourceHandle: string;
    target: ID;
    targetHandle: string;
  }) => {
    snapshot();
    const alreadyThere = edges.find((e) => e.source === source && e.target === target);
    if (alreadyThere) return removeEdge(alreadyThere.id);
    setEdges((old) => [
      ...old,
      {
        id: nanoid(ID_SIZE),
        source,
        sourceHandle,
        target,
        targetHandle,
        type: sourceHandle === 'condition' ? 'condition' : 'normal',
        animated: sourceHandle !== 'condition',
      },
    ]);
  };

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    [setNodes]
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      snapshot();
      setEdges((eds) => applyEdgeChanges(changes, eds));
    },
    [setEdges]
  );
  const onConnect = useCallback(
    (connection: Connection) => {
      snapshot();
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: connection.sourceHandle === 'condition' ? 'condition' : 'normal',
            animated: connection.sourceHandle !== 'condition',
          },
          eds
        )
      );
    },
    [setEdges]
  );
  const removeEdge = useCallback(
    (edgeId: ID) => setEdges((eds) => eds.filter((e) => e.id !== edgeId)),
    [setEdges]
  );
  const onEdgeUpdate = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      snapshot();
      setEdges((els) => updateEdge(oldEdge, newConnection, els));
    },
    [setEdges]
  );
  const onNodeDragStart = useCallback(
    (e: React.MouseEvent, rawNode: ChatNode) => {
      snapshot();
      if (!altPressed) return true;
      const _clonedSelectedNodes = cloneDeep(selectedNodes);
      const clonedSelectedNodes = _clonedSelectedNodes.length ? _clonedSelectedNodes : [rawNode];
      lastCopied.current = clonedSelectedNodes;
      const newNodes = cloneDeep(clonedSelectedNodes).map((node) => ({
        ...node,
        id: nanoid(ID_SIZE),
        selected: true,
        data: {
          ...node.data,
          isCopy: true,
        },
      }));
      setNodes((nds) => [...nds.map((nd) => ({ ...nd, selected: false })), ...newNodes]);
      // const relatedEdges = getRelatedEdges(node.id).map((e) => ({
      //   ...e,
      //   id: nanoid(ID_SIZE),
      //   source: e.source === node.id ? newNodeId : e.source,
      //   target: e.target === node.id ? newNodeId : e.target,
      // }));
      // setEdges((eds) => [...eds, ...relatedEdges]);
      return true;
    },
    [altPressed, setNodes]
  );

  const onNodeDrag = useCallback(
    (e: React.MouseEvent, node: ChatNode) => {
      if (!altPressed || !lastCopied.current) return;
      setNodes((nds) =>
        nds.map((nd) => {
          const lastCopiedNd = lastCopied.current!.find((cnd) => cnd.id === nd.id);
          return lastCopiedNd
            ? {
                ...nd,
                data: {
                  ...nd.data,
                  isCopy: false,
                },
                position: {
                  x: lastCopiedNd.position.x,
                  y: lastCopiedNd.position.y,
                },
              }
            : nd;
        })
      );
      return true;
    },
    [altPressed, setNodes]
  );
  const onNodeDragStop = useCallback(
    (e: React.MouseEvent, node: ChatNode) => {
      lastCopied.current = null;
      if (!altPressed) return true;
      setNodes((nds) =>
        nds.map((nd) =>
          nd.selected
            ? { ...nd, data: { ...nd.data, isCopy: false } }
            : { ...nd, selected: false, draggable: true }
        )
      );
      return true;
    },
    [altPressed, setNodes]
  );

  useEffect(() => {
    if (!altPressed) {
      setNodes((nds) => nds.filter((nd) => !nd.data.isCopy));
    }
  }, [altPressed]);

  const onStartDragToAddNewNode = () => {
    snapshot();
    setTimeout(() => {
      setIsAddingNewNode(true);
    }, 150);
  };

  const onEndDragToAddNewNode = (_e: DraggableEvent, info: DraggableData) => {
    if (!reactFlowInstance) return;
    setIsAddingNewNode('ending');
    setTimeout(() => {
      setIsAddingNewNode(false);
    }, 1);
    const newNode = initialChatNodeData();
    newNode.position = reactFlowInstance.project({
      x: info.x - 138,
      y: info.y + window.innerHeight - 282,
    });
    setNodes((nds) => [...nds, newNode]);
  };

  const setWorkspace = (id: ID) => {
    setSelectedWorkspaceId(id);
    const firstChat = data.current.find((x) => x.id === id)?.chats[0];
    setSelectedChatId(firstChat ? firstChat.id : null);
  };

  const playFrom = (firstNode?: ChatNode): void => {
    if (!firstNode) {
      playModeAnswersIds.current = [];
      return setWhatToPlay(null);
    }
    const getLinkedNodes = (node: ChatNode, handler: 'yes' | 'no' | 'condition' | 'a' = 'a') => {
      const relatedEdges = getRelatedEdges(node.id);
      const nextNodes = nodes.filter((x) =>
        relatedEdges
          .filter((x) => x.source === node.id && x.sourceHandle === handler)
          .map((e) => e.target)
          .includes(x.id)
      );
      return nextNodes;
    };
    const whatToShow = (rawNodes: ChatNode[]): ChatNode[] =>
      rawNodes
        .map((nd) => {
          switch (nd.type) {
            case CHAT_NODE_CONDITION_TYPE:
              const conditionNodeIds = getLinkedNodes(nd, 'condition').map((x) => x.id);
              return conditionNodeIds.every((id) => playModeAnswersIds.current?.includes(id))
                ? getLinkedNodes(nd, 'yes')
                    .map((x) => (x.type === CHAT_NODE_CONDITION_TYPE ? whatToShow([x]) : x))
                    .flat()
                : getLinkedNodes(nd, 'no')
                    .map((x) => (x.type === CHAT_NODE_CONDITION_TYPE ? whatToShow([x]) : x))
                    .flat();
            default:
              return nd;
          }
        })
        .flat();

    switch (firstNode.type) {
      case CHAT_NODE_CONDITION_TYPE: {
        return playFrom(whatToShow(getLinkedNodes(firstNode, 'no'))[0]);
      }
      case CHAT_NODE_ANSWER_TYPE: {
        playModeAnswersIds.current = [...playModeAnswersIds.current, firstNode.id];
        return playFrom(whatToShow(getLinkedNodes(firstNode))[0]);
      }
      case CHAT_NODE_TEXT_TYPE: {
        setWhatToPlay({
          toShow: firstNode,
          buttons: whatToShow(getLinkedNodes(firstNode, 'a')),
        });
        break;
      }
      default: {
        break;
      }
    }
  };

  const play = () => {
    if (!selectedNodes || selectedNodes.length !== 1) return;
    playFrom(selectedNodes[0]);
  };

  const focusOn = (id: ID, spotlight?: boolean) => {
    if (!reactFlowInstance) return;
    const node = nodes.find((x) => x.id === id);
    if (!node) return;
    const halfs = {
      [CHAT_NODE_CONDITION_TYPE]: {
        x: 110,
        y: 72,
      },
      [CHAT_NODE_ANSWER_TYPE]: {
        x: 124.5,
        y: 87.5,
      },
      [CHAT_NODE_TEXT_TYPE]: {
        x: 124.5,
        y: 87.5,
      },
    };
    setSpotlight(spotlight ? node.id : null);
    reactFlowInstance.setCenter(
      node.position.x + halfs[node.type as ChatNodeTypes].x,
      node.position.y + halfs[node.type as ChatNodeTypes].y,
      { zoom: 1, duration: 500 }
    );
  };

  const resetZoom = () => {
    if (!reactFlowInstance) return;
    reactFlowInstance.zoomTo(1, { duration: 500 });
  };

  const exportToJson = (id: ID) => {
    const dataCopy = transformData();
    const target = dataCopy.find((x) => x.id === id);
    if (!target) return;
    downloadFile({
      data: JSON.stringify(target),
      fileName: `${target.name}-Chats.json`,
      fileType: 'text/json',
    });
  };

  const importFromJson = (ref: React.RefObject<HTMLInputElement>, _e: any) => {
    const e = _e;
    const reader = new FileReader();
    reader.onload = (event) => {
      const newWorkspace = JSON.parse(event.target?.result as string);
      if (!newWorkspace) return;
      try {
        const transformedData: Workspace = {
          ...newWorkspace,
          chats: newWorkspace.chats.map(
            (ch: any): Chat => ({
              ...ch,
              nodes: ch.nodes.map(
                (nd: any): ChatNode => ({
                  id: nd.id,
                  type: nd.type,
                  position: nd.tonyData.position,
                  data: {
                    message: nd.message,
                    character: nd.character,
                  },
                })
              ),
              edges: ch.nodes
                .map(
                  (nd: any): Edge =>
                    nd.type === CHAT_NODE_CONDITION_TYPE
                      ? [
                          ...nd.goesTo.conditions.map((g: ID) => ({
                            id: nanoid(ID_SIZE),
                            source: nd.id,
                            target: g,
                          })),
                          ...nd.goesTo.yes.map((g: ID) => ({
                            id: nanoid(ID_SIZE),
                            source: nd.id,
                            target: g,
                          })),
                          ...nd.goesTo.no.map((g: ID) => ({
                            id: nanoid(ID_SIZE),
                            source: nd.id,
                            target: g,
                          })),
                        ]
                      : nd.goesTo.map((g: ID) => ({
                          id: nanoid(ID_SIZE),
                          source: nd.id,
                          target: g,
                        }))
                )
                .flat(),
            })
          ),
        };
        snapshot();
        setWorkspacesNames((old) => [
          ...old,
          { id: transformedData.id, name: transformedData.name },
        ]);
        data.current = [...data.current, transformedData];
        ref.current!.value = '';
      } catch (error) {
        console.log(error);
        alert('Invalid JSON file');
      }
    };
    reader.readAsText(e.target.files[0]);
  };

  const isConnectionValid = useCallback(
    memoizee(
      (
        sourceId: ID,
        targetId: ID,
        sourceHandle: string | null,
        _targetHandle: string | null
      ): boolean => {
        const _sourceNode = nodes.find((x) => x.id === sourceId);
        const _targetNode = nodes.find((x) => x.id === targetId);
        const sourceNode = sourceHandle === 'target' ? _targetNode : _sourceNode;
        const targetNode = sourceHandle === 'target' ? _sourceNode : _targetNode;
        if (!sourceNode || !targetNode) return false;

        const isItAMatch = (internalSourceNode: ChatNode, targets: ChatNode[]) => {
          const rules = {
            [CHAT_NODE_TEXT_TYPE]: () =>
              targets.every((x) => x.type === CHAT_NODE_ANSWER_TYPE) ||
              (targets.length === 1 && targets[0].type === CHAT_NODE_TEXT_TYPE),
            [CHAT_NODE_ANSWER_TYPE]: () =>
              targets.length === 1 && targets[0].type === CHAT_NODE_TEXT_TYPE,
            [CHAT_NODE_CONDITION_TYPE]: () =>
              sourceHandle === 'condition'
                ? targets.every((x) => x.type === CHAT_NODE_ANSWER_TYPE)
                : targets.every((x) => x.type === CHAT_NODE_ANSWER_TYPE) ||
                  (targets.length === 1 && targets[0].type === CHAT_NODE_TEXT_TYPE),
          };
          return rules[internalSourceNode.type as keyof typeof rules]();
        };

        const getNextNodes = (
          node: ChatNode,
          handler: 'yes' | 'no' | 'condition' | 'a' | string | null = 'a'
        ) => {
          const relatedEdges = getRelatedEdges(node.id);
          const nextNodes = nodes.filter((x) =>
            relatedEdges
              .filter((x) => x.source === node.id && x.sourceHandle === handler)
              .map((e) => e.target)
              .includes(x.id)
          );
          return nextNodes;
          // hihi
        };

        const getActualIsItAMatch = (
          childrenNodes: ChatNode[],
          _base: ChatNode[] = [],
          alternateSource?: ChatNode
        ): boolean => {
          if (childrenNodes.length === 0) return true;
          const base: ChatNode[] = [..._base];
          const normalNodes = childrenNodes.filter((x) => x.type !== CHAT_NODE_CONDITION_TYPE);
          const conditionNodes = childrenNodes.filter((x) => x.type === CHAT_NODE_CONDITION_TYPE);
          base.push(...normalNodes);
          if (!conditionNodes.length) return isItAMatch(alternateSource || sourceNode, base);
          let yesChildren: ChatNode[] = [];
          let noChildren: ChatNode[] = [];
          conditionNodes.forEach((nd) => {
            yesChildren =
              nd.id === sourceId && sourceHandle === 'yes'
                ? [targetNode, ...getNextNodes(nd, 'yes')]
                : getNextNodes(nd, 'yes');
            noChildren =
              nd.id === sourceId && sourceHandle === 'no'
                ? [targetNode, ...getNextNodes(nd, 'no')]
                : getNextNodes(nd, 'no');
          });
          return (
            getActualIsItAMatch(yesChildren, base, alternateSource) &&
            getActualIsItAMatch(noChildren, base, alternateSource)
          );
        };

        const findNearestNormalParents = (node: ChatNode) => {
          const relatedEdges = getRelatedEdges(node.id);
          const parentNodes = nodes.filter((x) =>
            relatedEdges
              .filter((e) => e.target === node.id)
              .map((e) => e.source)
              .includes(x.id)
          );
          const newParentNodes: ChatNode[] = parentNodes
            .map((x) => (x.type === CHAT_NODE_CONDITION_TYPE ? findNearestNormalParents(x) : x))
            .flat();
          return newParentNodes;
        };

        if (sourceNode.type !== CHAT_NODE_CONDITION_TYPE) {
          return getActualIsItAMatch([targetNode, ...getNextNodes(sourceNode)]);
        }

        if (sourceHandle === 'condition') {
          return isItAMatch(sourceNode, [targetNode, ...getNextNodes(sourceNode, sourceHandle)]);
        }

        return (
          getActualIsItAMatch([targetNode, ...getNextNodes(sourceNode, sourceHandle)], []) &&
          findNearestNormalParents(sourceNode).every((x) =>
            getActualIsItAMatch(getNextNodes(x), [], x)
          )
        );
      }
    ),
    [nodes, getRelatedEdges]
  );

  useEffect(() => {
    if (!scheduleSnapshop) return;
    snapshot();
    setScheduleSnapshot(false);
  }, [scheduleSnapshop]);

  return (
    <>
      {!!whatToPlay && (
        <PlayModeWrapper>
          <div>
            <CharacterPlayModeName>
              {characters &&
                (characters.find((char) => char.id === whatToPlay.toShow.data.character)?.name ||
                  'No one')}{' '}
              said:
            </CharacterPlayModeName>
            <p>{whatToPlay.toShow.data.message}</p>
            {whatToPlay.buttons.length > 0 ? (
              whatToPlay.buttons.map((btn) => (
                <Button key={btn.id} onClick={() => playFrom(btn)}>
                  {btn.type === CHAT_NODE_TEXT_TYPE ? 'Next' : btn.data.message}
                </Button>
              ))
            ) : (
              <Button onClick={() => playFrom()}>Finish</Button>
            )}
          </div>
        </PlayModeWrapper>
      )}
      <OverlayWrapper>
        <OTopLeft data-testid="workspaces-list">
          <FScreenListing
            numberOfRecentItems={2}
            listName="Workspaces"
            items={workspacesNames}
            icon={<FiBox />}
            selectedItemId={selectedWorkspaceId}
            onItemClick={setWorkspace}
            onItemValueChange={changeWorkspaceName}
            onItemDelete={deleteWorkspace}
            onItemDownload={exportToJson}
            extraOptions={[
              {
                value: 'New workspace',
                icon: <FiPlus />,
                color: 'add',
                onClick: addWorkspace,
                testId: 'add-workspace',
              },
              {
                value: 'Import workspace',
                icon: <FiUpload />,
                color: 'add',
                discrete: false,
                onFileChange: importFromJson,
              },
            ]}
          />
        </OTopLeft>
        <OTopLeftUnder>
          {selectedWorkspace && characters && (
            <FScreenListing
              listName="Characters"
              items={characters}
              numberOfRecentItems={0}
              icon={<FiUser />}
              onItemValueChange={changeCharName}
              onItemDelete={deleteChar}
              extraOptions={[
                {
                  value: 'New character',
                  icon: <FiPlus />,
                  color: 'add',
                  onClick: addChar,
                  discrete: true,
                },
              ]}
            />
          )}
        </OTopLeftUnder>
        <OTopRight>
          <SettingsWidget />
          <FixedButton
            disabled={!selectedNodes || selectedNodes.length !== 1}
            icon={<FiPlay />}
            onClick={play}
            color="add"
            value="Play"
          />
          {/* <FixedButton
            onClick={() => {
              if (!window.confirm('Are you really sure?')) return;
              localStorage.removeItem('data');
              data.current = loadOrSave();
            }}
            color="delete"
            icon={<FiTrash2 />}
            value="Erase all data"
          /> */}
          <ZoomButton onClick={resetZoom} value={`${(zoom * 100).toFixed(0)}%`} />
          <LoginWidget />
        </OTopRight>
        <OTopRightUnder>
          {selectedNodes?.length > 0 && (
            <SidePanel
              data-testid="side-panel"
              tagColor={
                theme.nodeColors[
                  COLORS[selectedNodes[0].type as ChatNodeTypes] as
                    | 'answerNode'
                    | 'textNode'
                    | 'conditionNode'
                ]
              }
            >
              <SidePanelContent>
                {selectedNodes.length === 1 ? (
                  <ItemTitleBar>
                    <ItemTitle>
                      {selectedNodes[0].type === CHAT_NODE_TEXT_TYPE ? (
                        <FiMessageSquare />
                      ) : (
                        <FiList />
                      )}
                      {selectedNodes[0].type}
                    </ItemTitle>
                    <IdTag>{selectedNodes[0].id}</IdTag>
                  </ItemTitleBar>
                ) : (
                  <Title style={{ margin: 0 }}>{selectedNodes.length} nodes selected</Title>
                )}
                <TypeChooserWrapper>
                  <TypeChooser
                    onClick={() => changeTypes(selectedNodes, CHAT_NODE_TEXT_TYPE)}
                    selected={selectedNodes.every((nd) => nd.type === CHAT_NODE_TEXT_TYPE)}
                    data-testid="text-type"
                  >
                    <FiMessageSquare />
                    <span>Text</span>
                  </TypeChooser>
                  <TypeChooser
                    onClick={() => changeTypes(selectedNodes, CHAT_NODE_ANSWER_TYPE)}
                    selected={selectedNodes.every((nd) => nd.type === CHAT_NODE_ANSWER_TYPE)}
                    data-testid="answer-type"
                  >
                    <FiList />
                    <span>Answer</span>
                  </TypeChooser>
                  <TypeChooser
                    onClick={() => changeTypes(selectedNodes, CHAT_NODE_CONDITION_TYPE)}
                    selected={selectedNodes.every((nd) => nd.type === CHAT_NODE_CONDITION_TYPE)}
                    data-testid="condition-type"
                  >
                    <FiHelpCircle />
                    <span>Condition</span>
                  </TypeChooser>
                </TypeChooserWrapper>
                {selectedNodes.length === 1 &&
                  selectedNodes[0].type !== CHAT_NODE_CONDITION_TYPE && (
                    <Textarea
                      onChange={handleInputChange}
                      name="message"
                      value={selectedNodes[0].data.message}
                    />
                  )}
                {selectedNodes.length === 1 && selectedNodes[0].type === CHAT_NODE_CONDITION_TYPE && (
                  <>
                    <Input
                      onChange={handleInputChange}
                      name="name"
                      placeholder="Condition name"
                      value={selectedNodes[0].data.name || ''}
                    />
                    <h4 style={{ margin: 0 }}>Conditions</h4>
                    <SelectableList
                      style={{ padding: 0, fontSize: 12 }}
                      options={
                        conditionsBundle
                          .find((cond) => cond.id === selectedNodes[0].id)
                          ?.nodes.map((ndId) => ({
                            label: nodes.find((nd) => nd.id === ndId)!.data.message,
                            icon: <FiList size={16} />,
                            type: 'item',
                            onMouseEnter: () => focusOn(ndId, true),
                            onMouseLeave: () => focusOn(selectedNodes[0].id),
                          })) || []
                      }
                    />
                  </>
                )}
              </SidePanelContent>
            </SidePanel>
          )}
        </OTopRightUnder>
        <OBottomLeft>
          {selectedWorkspace && (
            <FScreenListing
              data-testid="chats-list"
              listName="Chats"
              items={chatsNames}
              icon={<FiMessageSquare />}
              selectedItemId={selectedChatId}
              onItemClick={setSelectedChatId}
              onItemValueChange={changeChatName}
              onItemDelete={deleteChat}
              extraOptions={[
                {
                  value: 'New chat',
                  icon: <FiPlus />,
                  color: 'add',
                  onClick: addChat,
                  testId: 'add-chat',
                },
              ]}
            />
          )}
        </OBottomLeft>
      </OverlayWrapper>
      {(!selectedChatId || !selectedWorkspaceId || !selectedWorkspace || !selectedChat) && (
        <BackgroundTip bottomArrow={!!selectedWorkspaceId}>
          <span>{!selectedWorkspaceId ? <FiCornerLeftUp /> : <FiCornerLeftDown />}</span>
          Select or create a {!selectedWorkspaceId || !selectedWorkspace ? 'workspace' : 'chat'}
        </BackgroundTip>
      )}
      {!!selectedChat && (
        <StyledReactFlow
          data-testid="react-flow"
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodes={nodes.map((node) => ({
            ...node,
            data: {
              ...node.data,
              spacePressed,
              setCharacter,
              characters: characters,
              isConnectionValid,
              newEdge,
              fadeOut: typeof spotlight === 'string' && node.id !== spotlight,
              conditionsBundle,
              availableConditions: nodes.filter((nd) => nd.type === CHAT_NODE_CONDITION_TYPE),
            },
          }))}
          edges={edges.map((edge) => ({
            ...edge,
            data: {
              ...edge.data,
              spacePressed,
              removeEdge,
            },
          }))}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onEdgeUpdate={onEdgeUpdate}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onInit={setReactFlowInstance}
          onConnect={onConnect}
          selectNodesOnDrag
          selectionKeyCode={true}
          multiSelectionKeyCode={multiselectKeys}
          minZoom={0.1}
          maxZoom={4}
          panOnDrag={spacePressed}
          allowPanOverNodes
          onlyRenderVisibleElements
          panning={spacePressed}
          elevateEdgesOnSelect
        >
          <StyledMiniMap
            maskColor={
              getLuminance(theme.colors.bg) > 0.4 ? undefined : lighten(0.2, theme.colors.bg)
            }
            nodeBorderRadius={16}
            nodeColor={(node: ChatNode) =>
              theme.nodeColors[
                COLORS[node.type as ChatNodeTypes] as 'answerNode' | 'textNode' | 'conditionNode'
              ]
            }
          />
          <Background />
        </StyledReactFlow>
      )}
      <div ref={reactFlowWrapper}>
        {selectedWorkspaceId && selectedChatId && (
          <Draggable
            position={{ x: 0, y: 0 }}
            scale={1}
            onStart={onStartDragToAddNewNode}
            onStop={onEndDragToAddNewNode}
          >
            <CardAdd ref={newItemRef} isAddingNewNode={isAddingNewNode}>
              <ChatNodeCard
                xPos={0}
                yPos={0}
                isConnectable={false}
                id="addNode"
                type="text"
                zIndex={1}
                selected={false}
                dragging={false}
                data={{
                  message: 'Add me!',
                  character: null,
                }}
                testId="add-node-handler"
              />
            </CardAdd>
          </Draggable>
        )}
      </div>
      <a href="https://discord.gg/YgZSgp8kVR" target="_blank">
        <Discord src={discordIcon} alt="Discord Server" />
      </a>
      <a href="https://www.craft.do/s/z5nxQvBJx5HdJf" target="_blank">
        <Help>
          <FiHelpCircle />
        </Help>
      </a>
      <a href="https://www.paypal.com/donate/?hosted_button_id=HWYQF3KTYDY46" target="_blank">
        <Donate>
          <FiHeart />
        </Donate>
      </a>
    </>
  );
};

export default Story;

const Discord = styled.img`
  position: fixed;
  right: 230px;
  bottom: 24px;
  z-index: 10;
  height: 24px;
  opacity: 0.5;
  transition: opacity 0.2s ease-out;
  &:hover {
    opacity: 1;
  }
`;

const Help = styled.div`
  position: fixed;
  right: 230px;
  bottom: 48px;
  z-index: 10;
  height: 32px;
  font-size: 24px;
  opacity: 0.5;
  transition: opacity 0.2s ease-out;
  color: ${({ theme }) => (getLuminance(theme.colors.bg) > 0.4 ? '#000' : '#fff')};
  &:hover {
    opacity: 1;
  }
`;

const Donate = styled(Help)`
  bottom: 77px;
  color: red;
`;

const BackgroundTip = styled.div<{ bottomArrow?: boolean }>`
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: ${({ theme }) => theme.colors.bg};
  z-index: -1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48px;
  color: gray;
  font-weight: 700;
  span {
    left: 24px;
    font-size: 72px;
    position: absolute;
    line-height: 0;
    top: ${({ bottomArrow }) => (bottomArrow ? 'unset' : '64px')};
    bottom: ${({ bottomArrow }) => (bottomArrow ? '64px' : 'unset')};
  }
`;

const ZoomButton = styled(FixedButton)`
  width: 69px;
  text-align: center;
  justify-content: center;
`;

const StyledMiniMap = styled(MiniMap)`
  border-radius: 16px;
  background: ${({ theme }) => lighten(0.1, theme.colors.bg)} !important;
`;

const OverlayWrapper = styled.div`
  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-template-rows: auto auto 1fr auto;
  gap: 10px 10px;
  grid-auto-flow: row;
  grid-template-areas:
    'topLeft . topRight'
    'topLeftUnder topRightUnder topRightUnder'
    '. . .'
    'bottomLeft . .';
  z-index: 11;
  position: fixed;
  height: 100%;
  width: 100%;
  pointer-events: none;
  padding: 16px;
  * > * {
    pointer-events: all;
  }
`;

const OArea = styled.div`
  display: flex;
  gap: 8px;
  align-items: flex-start;
  justify-content: flex-start;
`;

const OTopLeft = styled(OArea)`
  grid-area: topLeft;
`;
const OTopLeftUnder = styled(OArea)`
  grid-area: topLeftUnder;
`;
const OTopRight = styled(OArea)`
  grid-area: topRight;
  justify-content: flex-end;
`;
const OTopRightUnder = styled(OArea)`
  grid-area: topRightUnder;
  justify-content: flex-end;
`;
const OBottomLeft = styled(OArea)`
  grid-area: bottomLeft;
  align-items: flex-end;
`;

const CardAdd = styled.div<{ isAddingNewNode: boolean | 'ending' }>`
  position: fixed;
  bottom: 70px;
  left: ${({ isAddingNewNode }) => (isAddingNewNode === 'ending' ? '-185px' : '-110px')};
  z-index: 10;
  /* opacity: 0.6; */
  transition: opacity ${({ theme }) => theme.transitions.superQuick}ms ease-out,
    left ${({ isAddingNewNode }) => (isAddingNewNode === 'ending' ? 0 : 400)}ms
      cubic-bezier(0.23, 1.48, 0.325, 0.945);
  height: 249px;
  width: 175px;
  padding-top: 40px;
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(255, 255, 255, 0);
    backdrop-filter: blur(35px) saturate(200%);
    border-radius: 16px;
    z-index: -1;
  }
  & > div {
    opacity: 0.5;
  }
  ${({ isAddingNewNode }) =>
    isAddingNewNode !== 'ending' &&
    css`
      &:hover {
        & > div {
          opacity: 0.7;
        }
        /* opacity: 0.8; */
        left: -100px;
      }
    `}
  &.react-draggable-dragging {
    &::before {
      transform: rotate(90deg);
    }
    & > * {
      transform: rotate(0deg);
    }
  }
  & > * {
    position: relative;
    margin-left: -38px;
    margin-top: -3px;
    transition: ${({ isAddingNewNode, theme }) =>
      isAddingNewNode
        ? 'none'
        : `opacity ${theme.transitions.quick}ms ease-out, transform ${theme.transitions.quick}ms ease-out`} !important;
    transform: rotate(90deg);
  }
`;

const StyledReactFlow = styled(ReactFlow)<{ panning?: boolean }>`
  width: 100%;
  height: 100vh;
  background: ${({ theme }) => theme.colors.bg};
  cursor: ${({ panning }) => (panning ? 'grab' : 'default')};
  &:active {
    cursor: ${({ panning }) => (panning ? 'grabbing' : 'default')};
  }
`;

const PlayModeWrapper = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
  z-index: 20;
  background-color: ${({theme}) => theme.colors.blurBg};
  backdrop-filter: blur(35px) saturate(200%);
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 24px;
  & > div {
    max-width: 90%;
    width: 400px;
  }
`;

const CharacterPlayModeName = styled.div`
  font-weight: bold;
`;

const Button = styled.button<{ red?: boolean }>`
  display: flex;
  margin-top: 8px;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 48px;
  background: ${({ red }) => (red ? 'red' : '#0068f6')};
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease-in-out;
  align-self: flex-end;
  &:hover {
    background: ${({ red }) => (red ? '#ff5252' : '#0058d3')};
  }
`;

const TypeChooserWrapper = styled.div`
  display: flex;
  flex-direction: row;
`;

const TypeChooser = styled.button<{ selected: boolean }>`
  flex: 1;
  display: flex;
  border: none;
  flex-direction: column;
  align-items: center;
  margin: 5px;
  font-size: 16px;
  background: ${({ theme }) => theme.colors.inputBlurBg};
  border-radius: 5px;
  padding: 8px;
  gap: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  ${({ selected }) =>
    !selected &&
    css`
      color: gray !important;
    `};
  &:hover {
    background: ${({ theme }) =>
      getLuminance(theme.colors.bg) > 0.4
        ? darken(0.5, theme.colors.inputBlurBg)
        : lighten(0.1, theme.colors.inputBlurBg)};
  }
`;

const SidePanelContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
`;

const ItemTitleBar = styled.div`
  background: #0068f6;
  padding: 6px 12px;
  border-radius: 8px;
  text-transform: capitalize;
  color: white;
  display: flex;
  justify-content: space-between;
  padding-right: 8px;
  align-items: center;
  width: 100%;
`;

const ItemTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
  width: 100%;
`;

const IdTag = styled.div`
  background: white;
  padding: 1px 6px;
  color: #0068f6;
  font-size: 12px;
  font-weight: 600;
  border-radius: 4px;
  line-height: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
`;

const SidePanel = styled.div<{ tagColor?: string | false }>`
  width: 360px;
  background: ${({ theme }) => theme.colors.blurBg};
  padding: 25px;
  border-radius: 24px;
  box-shadow: 0px 10px 20px rgba(0, 0, 0, 0.1);
  border: solid 1px ${({ theme }) => theme.colors.blurBorderColor};
  z-index: 9;
  display: flex;
  flex-direction: column;
  gap: 16px;
  backdrop-filter: blur(35px) saturate(200%);
  ${ItemTitleBar}, ${IdTag} {
    background: ${({ tagColor }) => tagColor};
    color: ${({ tagColor }) =>
      getLuminance(tagColor || '#fff') > 0.4 ? colors.light.font : colors.dark.font};
  }
  ${IdTag}, ${TypeChooser} {
    color: ${({ tagColor }) => tagColor || '#fff'};
  }
  -webkit-user-drag: none;
  & * {
    user-select: none;
    -webkit-user-drag: none;
  }
`;
