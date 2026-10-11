import unittest
from api import demo_blocks as game

class DemoBlockRules(unittest.TestCase):
    def test_invalid_entries(self):
        for entry in (0,-500,501,True,500.0,'500'):
            with self.assertRaises(ValueError): game.new_game(entry)

    def test_illegal_move_does_not_mutate_state(self):
        state = game.new_game(500)
        for x in (-1,8,999):
            with self.assertRaises(ValueError): game.advance(state,'move',{'piece':0,'x':x,'y':0})
        self.assertEqual(state['revision'],0)
        self.assertFalse(any(state['board']))

    def test_cleared_row_and_combo_reward(self):
        state=game.new_game(500)
        state['board'][:7]=['cyan']*7
        state['pieces'][0]['shape']=[(0,0)]
        result=game.advance(state,'move',{'piece':0,'x':7,'y':0})
        self.assertEqual(result['lastClear'],1)
        self.assertEqual(result['amount'],50)
        self.assertEqual(result['combo'],1)
        self.assertEqual(result['score'],100)
        self.assertEqual(result['revision'],1)
        self.assertFalse(any(result['board']))
        with self.assertRaises(ValueError): game.advance(result,'move',{'piece':0,'x':0,'y':0})

    def test_sixth_clear_increases_difficulty_after_reward(self):
        state=game.new_game(500)
        state['combo']=5
        state['board'][:7]=['cyan']*7
        state['pieces'][0]['shape']=[(0,0)]
        result=game.advance(state,'move',{'piece':0,'x':7,'y':0})
        self.assertEqual(result['lastCashGain'],125)
        self.assertEqual(result['difficulty'],1)

    def test_finish_has_only_virtual_result(self):
        state=game.new_game(500)
        with self.assertRaises(ValueError): game.advance(state,'finish',{})
        state['amount']=600
        result=game.advance(state,'finish',{})
        self.assertEqual(result['virtualResult'],1100)
        self.assertEqual(result['mode'],'demo')
        with self.assertRaises(ValueError): game.advance(result,'finish',{})

    def test_loss_has_zero_result(self):
        state=game.new_game(500)
        state['board']=['cyan' if (x+y)%2 else None for y in range(8) for x in range(8)]
        state['pieces']=[{'id':0,'shape':[(0,0)],'used':False,'color':'cyan'}, {'id':1,'shape':[(0,0),(1,0)],'used':False,'color':'cyan'}, {'id':2,'shape':[(0,0),(1,0)],'used':False,'color':'cyan'}]
        state['amount']=400
        result=game.advance(state,'move',{'piece':0,'x':0,'y':0})
        self.assertEqual(result['status'],'lost')
        self.assertEqual(result['virtualResult'],0)
        with self.assertRaises(ValueError): game.advance(result,'finish',{})
